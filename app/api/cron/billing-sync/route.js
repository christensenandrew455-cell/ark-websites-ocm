import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminDb } from "../../../lib/firebase-admin";
import { TERMS_VERSION } from "../../../lib/legal";
import {
  ensureCustomerBillingSubscription,
  MONTHLY_BASE_CENTS,
  PER_LEAD_CENTS,
  reportBillableLead,
} from "../../../lib/stripeUsageBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) {
  return String(value || "").trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function authorized(request) {
  const secret = text(process.env.CRON_SECRET);
  const authorization = text(request.headers.get("authorization"));
  if (secret) return authorization === `Bearer ${secret}`;
  return text(request.headers.get("user-agent")).includes("vercel-cron/1.0");
}

function monthWindowUtc() {
  const now = new Date();
  return {
    monthKey: now.toISOString().slice(0, 7),
    startMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    endMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  };
}

function leadKey(clientId, leadId) {
  return createHash("sha256").update(`${clientId}:${leadId}`).digest("hex").slice(0, 48);
}

function addLead(unique, id, occurredAt, startMs, endMs) {
  const cleanId = text(id);
  if (!cleanId || !occurredAt || occurredAt < startMs || occurredAt >= endMs) return;
  const existing = unique.get(cleanId);
  if (!existing || occurredAt < existing.occurredAt) unique.set(cleanId, { id: cleanId, occurredAt });
}

async function monthlyLeads(db, clientId, startMs, endMs) {
  const root = db.collection("ocmClients").doc(clientId);
  const [contacted, clients, stats] = await Promise.all([
    root.collection("contactedMe").get(),
    root.collection("clients").get(),
    root.collection("statsEvents").get(),
  ]);
  const unique = new Map();

  for (const document of [...contacted.docs, ...clients.docs]) {
    const data = document.data();
    const occurredAt = toMillis(data.createdAt || data.contactedAt || data.acceptedAt || data.updatedAt);
    addLead(unique, document.id, occurredAt, startMs, endMs);
  }
  for (const document of stats.docs) {
    const data = document.data();
    if (text(data.eventType).toLowerCase() !== "contacted") continue;
    const sourceId = text(data.sourceId) || document.id.replace(/^contacted:/, "");
    const occurredAt = toMillis(data.occurredAt || data.createdAt || data.updatedAt);
    addLead(unique, sourceId, occurredAt, startMs, endMs);
  }

  return [...unique.values()];
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });

  const db = getAdminDb();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const window = monthWindowUtc();
  const businesses = await db.collection("businesses").where("status", "==", "active").get();
  const results = [];

  for (const document of businesses.docs) {
    const clientId = document.id;
    const business = document.data();
    const uid = text(business.uid || business.ownerUid);
    try {
      const accountSnapshot = uid ? await db.collection("accounts").doc(uid).get() : null;
      const account = accountSnapshot?.exists ? accountSnapshot.data() : {};
      const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
      const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
      const acceptedCurrentTerms = account.termsAccepted === true && text(account.termsVersion) === TERMS_VERSION;
      const leads = await monthlyLeads(db, clientId, window.startMs, window.endMs);
      const amountDue = MONTHLY_BASE_CENTS + leads.length * PER_LEAD_CENTS;
      let synced = 0;

      if (customerId && paymentMethodId && acceptedCurrentTerms) {
        const subscription = await ensureCustomerBillingSubscription({
          stripe,
          db,
          clientId,
          customerId,
          paymentMethodId,
          businessName: text(business.businessName || account.businessName || clientId),
          uid,
          existingSubscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
        });

        for (const lead of leads) {
          const recordRef = db.collection("ocmClients").doc(clientId).collection("billingLeadEvents").doc(leadKey(clientId, lead.id));
          const record = await recordRef.get();
          if (record.exists && record.data().stripeReported === true) continue;
          await reportBillableLead({ stripe, customerId, clientId, leadId: lead.id, occurredAt: lead.occurredAt });
          await recordRef.set({
            leadId: lead.id,
            occurredAt: new Date(lead.occurredAt),
            stripeReported: true,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            reportedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          synced += 1;
        }
      }

      await document.ref.set({
        currentBillingMonth: window.monthKey,
        currentMonthLeadCount: leads.length,
        currentMonthAmountDue: amountDue,
        currentMonthCurrency: "usd",
        billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      results.push({ clientId, leads: leads.length, amountDue, synced });
    } catch (error) {
      console.error(`Billing sync failed for ${clientId}`, error);
      results.push({ clientId, error: String(error?.message || "Billing sync failed.") });
    }
  }

  return NextResponse.json({ ok: true, monthKey: window.monthKey, accounts: results.length, results });
}
