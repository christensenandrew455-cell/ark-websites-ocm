import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminDb } from "../../../lib/firebase-admin";
import { TERMS_VERSION } from "../../../lib/legal";
import {
  getReceptionistPlan,
  monthKeyInTimeZone,
  receptionistOverage,
} from "../../../lib/receptionistPricing";
import {
  ensureCustomerBillingSubscription,
  reportBillableCall,
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

function callEventKey(clientId, callId) {
  return createHash("sha256").update(`${clientId}:${callId}`).digest("hex").slice(0, 48);
}

function isBillableCall(call) {
  if (call.billable === false) return false;
  if (call.billable === true) return true;
  return Number(call.durationSeconds || 0) >= Number(call.minimumBillableSeconds || 20);
}

function callOrder(call) {
  const sequence = Number(call.billableSequence);
  if (Number.isFinite(sequence) && sequence > 0) return sequence;
  return Number.MAX_SAFE_INTEGER;
}

async function monthlyCalls(db, clientId, monthKey) {
  const snapshot = await db.collection("ocmClients").doc(clientId).collection("receptionistCalls").get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((call) => isBillableCall(call) && text(call.monthKey) === monthKey)
    .sort((first, second) => {
      const sequenceDifference = callOrder(first) - callOrder(second);
      if (sequenceDifference !== 0) return sequenceDifference;
      return toMillis(first.startedAt || first.endedAt || first.createdAt) - toMillis(second.startedAt || second.endedAt || second.createdAt);
    });
}

async function applyPendingPlan({ db, clientId, uid, business, currentMonthKey }) {
  const pendingKey = text(business.pendingReceptionistPlanKey);
  const pendingMonth = text(business.pendingReceptionistPlanEffectiveMonth);
  const currentPlan = getReceptionistPlan(business.receptionistPlanKey);
  if (!pendingKey || !pendingMonth || pendingMonth > currentMonthKey) return currentPlan;

  const plan = getReceptionistPlan(pendingKey);
  const businessRef = db.collection("businesses").doc(clientId);
  const accountRef = uid ? db.collection("accounts").doc(uid) : null;
  const accountSettingsRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("account");
  const planUpdate = {
    receptionistPlanKey: plan.key,
    receptionistPlanName: plan.name,
    receptionistIncludedCalls: plan.includedCalls,
    receptionistMonthlyCents: plan.monthlyCents,
    receptionistOverageCents: plan.overageCents,
    pendingReceptionistPlanKey: FieldValue.delete(),
    pendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
    receptionistPlanUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    businessRef.set(planUpdate, { merge: true }),
    accountRef ? accountRef.set(planUpdate, { merge: true }) : Promise.resolve(),
    accountSettingsRef.set({
      ReceptionistPlanKey: plan.key,
      ReceptionistPlanName: plan.name,
      ReceptionistIncludedCalls: plan.includedCalls,
      ReceptionistMonthlyCents: plan.monthlyCents,
      ReceptionistOverageCents: plan.overageCents,
      PendingReceptionistPlanKey: FieldValue.delete(),
      PendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);

  return plan;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });

  const db = getAdminDb();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const businesses = await db.collection("businesses").where("status", "==", "active").get();
  const results = [];

  for (const document of businesses.docs) {
    const clientId = document.id;
    const business = document.data();
    const uid = text(business.uid || business.ownerUid);
    try {
      const root = db.collection("ocmClients").doc(clientId);
      const [accountSnapshot, receptionistSnapshot] = await Promise.all([
        uid ? db.collection("accounts").doc(uid).get() : Promise.resolve(null),
        root.collection("settings").doc("receptionist").get(),
      ]);
      const account = accountSnapshot?.exists ? accountSnapshot.data() : {};
      const timeZone = text(receptionistSnapshot?.exists ? receptionistSnapshot.data().timeZone : "") || "America/New_York";
      const currentMonthKey = monthKeyInTimeZone(new Date(), timeZone);
      const plan = await applyPendingPlan({ db, clientId, uid, business, currentMonthKey });
      const calls = await monthlyCalls(db, clientId, currentMonthKey);
      const usage = receptionistOverage(plan, calls.length);
      const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
      const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
      const acceptedCurrentTerms = account.termsAccepted === true && text(account.termsVersion) === TERMS_VERSION;
      let synced = 0;
      let subscriptionStatus = text(business.stripeSubscriptionStatus);

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
          planKey: plan.key,
        });
        subscriptionStatus = subscription.status;

        for (const call of calls.slice(plan.includedCalls)) {
          const recordRef = root.collection("billingCallEvents").doc(callEventKey(clientId, call.id));
          const record = await recordRef.get();
          if (record.exists && record.data().stripeReported === true) continue;
          const occurredAt = toMillis(call.startedAt || call.endedAt || call.createdAt) || Date.now();
          await reportBillableCall({ stripe, customerId, clientId, callId: call.id, occurredAt });
          await recordRef.set({
            callId: call.id,
            monthKey: currentMonthKey,
            occurredAt: new Date(occurredAt),
            stripeReported: true,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            planKey: plan.key,
            overageCents: plan.overageCents,
            reportedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          synced += 1;
        }
      }

      await document.ref.set({
        currentBillingMonth: currentMonthKey,
        currentMonthCallCount: calls.length,
        currentMonthIncludedCalls: plan.includedCalls,
        currentMonthOverageCalls: usage.overageCalls,
        currentMonthOverageAmount: usage.overageAmountCents,
        currentMonthAmountDue: usage.estimatedTotalCents,
        currentMonthCurrency: "usd",
        stripeSubscriptionStatus: subscriptionStatus,
        billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      results.push({
        clientId,
        planKey: plan.key,
        calls: calls.length,
        overageCalls: usage.overageCalls,
        amountDue: usage.estimatedTotalCents,
        synced,
      });
    } catch (error) {
      console.error(`Billing sync failed for ${clientId}`, error);
      results.push({ clientId, error: String(error?.message || "Billing sync failed.") });
    }
  }

  return NextResponse.json({ ok: true, accounts: results.length, results });
}
