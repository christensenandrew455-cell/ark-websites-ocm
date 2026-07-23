import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
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

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function zonedDateToUtc(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const first = zoneParts(new Date(guess), timeZone);
  const firstOffset = Date.UTC(first.year, first.month - 1, first.day, first.hour, first.minute, first.second) - guess;
  const adjusted = guess - firstOffset;
  const second = zoneParts(new Date(adjusted), timeZone);
  const secondOffset = Date.UTC(second.year, second.month - 1, second.day, second.hour, second.minute, second.second) - adjusted;
  return adjusted - secondOffset;
}

function monthWindow(timeZone) {
  const now = zoneParts(new Date(), timeZone);
  const nextYear = now.month === 12 ? now.year + 1 : now.year;
  const nextMonth = now.month === 12 ? 1 : now.month + 1;
  return {
    monthKey: `${now.year}-${String(now.month).padStart(2, "0")}`,
    startMs: zonedDateToUtc(now.year, now.month, 1, timeZone),
    endMs: zonedDateToUtc(nextYear, nextMonth, 1, timeZone),
  };
}

function leadTimestamp(data) {
  return toMillis(data.createdAt || data.contactedAt || data.acceptedAt || data.updatedAt);
}

function leadKey(clientId, leadId) {
  return createHash("sha256").update(`${clientId}:${leadId}`).digest("hex").slice(0, 48);
}

async function loadMonthlyLeads(db, clientId, startMs, endMs) {
  const [contactedSnapshot, clientsSnapshot] = await Promise.all([
    db.collection("ocmClients").doc(clientId).collection("contactedMe").get(),
    db.collection("ocmClients").doc(clientId).collection("clients").get(),
  ]);

  const unique = new Map();
  for (const document of [...contactedSnapshot.docs, ...clientsSnapshot.docs]) {
    const occurredAt = leadTimestamp(document.data());
    if (!occurredAt || occurredAt < startMs || occurredAt >= endMs) continue;
    const existing = unique.get(document.id);
    if (!existing || occurredAt < existing.occurredAt) unique.set(document.id, { id: document.id, occurredAt });
  }
  return [...unique.values()].sort((first, second) => first.occurredAt - second.occurredAt);
}

async function reconcileStripe({ db, auth, business, account, leads }) {
  if (!process.env.STRIPE_SECRET_KEY) return { status: "not-configured", synced: 0 };
  const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
  const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
  const acceptedCurrentTerms = account.termsAccepted === true && text(account.termsVersion) === TERMS_VERSION;
  if (!customerId || !paymentMethodId) return { status: "payment-method-required", synced: 0 };
  if (!acceptedCurrentTerms) return { status: "terms-required", synced: 0 };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const subscription = await ensureCustomerBillingSubscription({
    stripe,
    db,
    clientId: auth.clientId,
    customerId,
    paymentMethodId,
    businessName: text(business.businessName || account.businessName || auth.clientId),
    uid: auth.decodedToken.uid,
    existingSubscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
  });

  let synced = 0;
  for (const lead of leads) {
    const recordRef = db.collection("ocmClients").doc(auth.clientId).collection("billingLeadEvents").doc(leadKey(auth.clientId, lead.id));
    const record = await recordRef.get();
    if (record.exists && record.data().stripeReported === true) continue;

    await reportBillableLead({
      stripe,
      customerId,
      clientId: auth.clientId,
      leadId: lead.id,
      occurredAt: lead.occurredAt,
    });
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

  return { status: subscription.status, synced };
}

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(auth.clientId);
    const accountRef = db.collection("accounts").doc(auth.decodedToken.uid);
    const receptionistRef = db.collection("ocmClients").doc(auth.clientId).collection("settings").doc("receptionist");
    const [businessSnapshot, accountSnapshot, receptionistSnapshot] = await Promise.all([
      businessRef.get(),
      accountRef.get(),
      receptionistRef.get(),
    ]);

    if (!businessSnapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    const business = businessSnapshot.data();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "") || "America/New_York";
    const window = monthWindow(timeZone);
    const leads = await loadMonthlyLeads(db, auth.clientId, window.startMs, window.endMs);
    const amountDue = MONTHLY_BASE_CENTS + leads.length * PER_LEAD_CENTS;

    let stripe = { status: "not-synced", synced: 0 };
    try {
      stripe = await reconcileStripe({ db, auth, business, account, leads });
    } catch (stripeError) {
      console.error("Unable to reconcile monthly Stripe billing", stripeError);
      stripe = { status: "sync-error", synced: 0 };
    }

    await businessRef.set({
      currentBillingMonth: window.monthKey,
      currentMonthLeadCount: leads.length,
      currentMonthAmountDue: amountDue,
      currentMonthCurrency: "usd",
      billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({
      monthKey: window.monthKey,
      amountDue,
      currency: "usd",
      leadCount: leads.length,
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      perLeadCents: PER_LEAD_CENTS,
      stripeStatus: stripe.status,
      stripeLeadsSynced: stripe.synced,
    });
  } catch (error) {
    console.error("Unable to load monthly billing summary", error);
    return NextResponse.json({ error: "Could not calculate this month's amount due." }, { status: 500 });
  }
}
