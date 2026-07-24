import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { TERMS_VERSION } from "../../../lib/legal";
import {
  DEFAULT_RECEPTIONIST_PLAN_KEY,
  RECEPTIONIST_PLANS,
  adjacentMonthKey,
  getReceptionistPlan,
  monthKeyInTimeZone,
  receptionistOverage,
  receptionistPlanRange,
  receptionistPlanRecommendations,
  receptionistPlanSnapshot,
} from "../../../lib/receptionistPricing";
import {
  ensureCustomerBillingSubscription,
  reportBillableCall,
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

function callEventKey(clientId, callId) {
  return createHash("sha256").update(`${clientId}:${callId}`).digest("hex").slice(0, 48);
}

function isBillableCall(data) {
  if (data.billable === false) return false;
  if (data.billable === true) return true;
  return Number(data.durationSeconds || 0) >= Number(data.minimumBillableSeconds || 20);
}

async function loadMonthlyCalls(db, clientId, startMs, endMs, activeMonthKey) {
  const snapshot = await db.collection("ocmClients").doc(clientId).collection("receptionistCalls").get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((call) => {
      if (!isBillableCall(call)) return false;
      if (text(call.monthKey)) return text(call.monthKey) === activeMonthKey;
      const occurredAt = toMillis(call.startedAt || call.endedAt || call.createdAt);
      return occurredAt >= startMs && occurredAt < endMs;
    })
    .sort((first, second) => toMillis(first.startedAt || first.endedAt) - toMillis(second.startedAt || second.endedAt));
}

async function loadPreviousUsage(db, clientId, currentMonthKey) {
  const previousMonthKey = adjacentMonthKey(currentMonthKey, -1);
  const snapshot = await db.collection("ocmClients").doc(clientId).collection("usage").doc(`receptionist-${previousMonthKey}`).get();
  const data = snapshot.exists ? snapshot.data() : {};
  return {
    monthKey: previousMonthKey,
    billableCalls: Math.max(0, Number(data.billableCalls ?? data.totalCalls ?? 0)),
    exists: snapshot.exists,
  };
}

function planFields(plan) {
  return {
    receptionistPlanKey: plan.key,
    receptionistPlanName: plan.name,
    receptionistIncludedCalls: plan.includedCalls,
    receptionistMonthlyCents: plan.monthlyCents,
    receptionistOverageCents: plan.overageCents,
  };
}

function accountPlanFields(plan) {
  return {
    ReceptionistPlanKey: plan.key,
    ReceptionistPlanName: plan.name,
    ReceptionistIncludedCalls: plan.includedCalls,
    ReceptionistMonthlyCents: plan.monthlyCents,
    ReceptionistOverageCents: plan.overageCents,
  };
}

async function resolveActivePlan({ db, businessRef, accountRef, accountSettingsRef, business, currentMonthKey }) {
  let plan = getReceptionistPlan(business.receptionistPlanKey || DEFAULT_RECEPTIONIST_PLAN_KEY);
  const pendingPlanKey = text(business.pendingReceptionistPlanKey);
  const pendingEffectiveMonth = text(business.pendingReceptionistPlanEffectiveMonth);
  const shouldApplyPending = pendingPlanKey && pendingEffectiveMonth && pendingEffectiveMonth <= currentMonthKey;
  const planStartedMonth = text(business.receptionistPlanStartedMonth) || currentMonthKey;

  if (shouldApplyPending) plan = getReceptionistPlan(pendingPlanKey);

  const businessUpdate = {
    ...planFields(plan),
    receptionistPlanStartedMonth: planStartedMonth,
    ...(shouldApplyPending ? {
      pendingReceptionistPlanKey: FieldValue.delete(),
      pendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
      receptionistPlanUpdatedAt: FieldValue.serverTimestamp(),
    } : {}),
  };

  const accountUpdate = {
    ...planFields(plan),
    receptionistPlanStartedMonth: planStartedMonth,
    ...(shouldApplyPending ? {
      pendingReceptionistPlanKey: FieldValue.delete(),
      pendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
    } : {}),
  };

  const settingsUpdate = {
    ...accountPlanFields(plan),
    ReceptionistPlanStartedMonth: planStartedMonth,
    ...(shouldApplyPending ? {
      PendingReceptionistPlanKey: FieldValue.delete(),
      PendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
    } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    businessRef.set(businessUpdate, { merge: true }),
    accountRef.set(accountUpdate, { merge: true }),
    accountSettingsRef.set(settingsUpdate, { merge: true }),
  ]);

  return {
    plan,
    planStartedMonth,
    pendingPlanKey: shouldApplyPending ? "" : pendingPlanKey,
    pendingEffectiveMonth: shouldApplyPending ? "" : pendingEffectiveMonth,
  };
}

async function reconcileStripe({ db, auth, business, account, plan, calls }) {
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
    planKey: plan.key,
  });

  let synced = 0;
  const overageCalls = calls.slice(plan.includedCalls);
  for (const call of overageCalls) {
    const recordRef = db.collection("ocmClients").doc(auth.clientId).collection("billingCallEvents").doc(callEventKey(auth.clientId, call.id));
    const record = await recordRef.get();
    if (record.exists && record.data().stripeReported === true) continue;

    const occurredAt = toMillis(call.startedAt || call.endedAt || call.createdAt) || Date.now();
    await reportBillableCall({
      stripe,
      customerId,
      clientId: auth.clientId,
      callId: call.id,
      occurredAt,
    });
    await recordRef.set({
      callId: call.id,
      monthKey: text(call.monthKey),
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

  return { status: subscription.status, synced };
}

async function buildSummary(auth) {
  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(auth.clientId);
  const accountRef = db.collection("accounts").doc(auth.decodedToken.uid);
  const root = db.collection("ocmClients").doc(auth.clientId);
  const receptionistRef = root.collection("settings").doc("receptionist");
  const accountSettingsRef = root.collection("settings").doc("account");
  const [businessSnapshot, accountSnapshot, receptionistSnapshot, accountSettingsSnapshot] = await Promise.all([
    businessRef.get(),
    accountRef.get(),
    receptionistRef.get(),
    accountSettingsRef.get(),
  ]);

  if (!businessSnapshot.exists) {
    return { response: NextResponse.json({ error: "This business account could not be found." }, { status: 404 }) };
  }

  const business = businessSnapshot.data();
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  const accountSettings = accountSettingsSnapshot.exists ? accountSettingsSnapshot.data() : {};
  const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "") || "America/New_York";
  const window = monthWindow(timeZone);
  const active = await resolveActivePlan({
    db,
    businessRef,
    accountRef,
    accountSettingsRef,
    business,
    currentMonthKey: window.monthKey,
  });
  const calls = await loadMonthlyCalls(db, auth.clientId, window.startMs, window.endMs, window.monthKey);
  const usage = receptionistOverage(active.plan, calls.length);
  const previous = await loadPreviousUsage(db, auth.clientId, window.monthKey);
  const firstMonthComplete = active.planStartedMonth < window.monthKey;
  const recommendationCallCount = firstMonthComplete ? previous.billableCalls : 0;
  const recommendations = firstMonthComplete
    ? receptionistPlanRecommendations(recommendationCallCount)
    : [];
  const recommendedPlan = recommendations.find((option) => option.recommended) || null;
  const planRange = receptionistPlanRange(active.plan.key);

  let stripe = { status: "not-synced", synced: 0 };
  try {
    stripe = await reconcileStripe({ db, auth, business, account, plan: active.plan, calls });
  } catch (stripeError) {
    console.error("Unable to reconcile monthly Stripe receptionist billing", stripeError);
    stripe = { status: "sync-error", synced: 0 };
  }

  await businessRef.set({
    currentBillingMonth: window.monthKey,
    currentMonthCallCount: calls.length,
    currentMonthIncludedCalls: active.plan.includedCalls,
    currentMonthOverageCalls: usage.overageCalls,
    currentMonthOverageAmount: usage.overageAmountCents,
    currentMonthAmountDue: usage.estimatedTotalCents,
    currentMonthCurrency: "usd",
    receptionistRecommendationBasedOnMonth: firstMonthComplete ? previous.monthKey : "",
    receptionistRecommendationBasedOnCalls: recommendationCallCount,
    receptionistRecommendedPlanKey: recommendedPlan?.key || "",
    billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    summary: {
      monthKey: window.monthKey,
      amountDue: usage.estimatedTotalCents,
      currency: "usd",
      plan: receptionistPlanSnapshot(active.plan.key),
      callsUsed: calls.length,
      callsRemaining: usage.remainingCalls,
      overageCalls: usage.overageCalls,
      overageAmount: usage.overageAmountCents,
      firstMonthComplete,
      recommendationMonthKey: firstMonthComplete ? previous.monthKey : "",
      recommendationCallCount,
      recommendations,
      recommendedPlanKey: recommendedPlan?.key || "",
      currentPlanRange: planRange,
      pendingPlan: active.pendingPlanKey ? {
        ...receptionistPlanSnapshot(active.pendingPlanKey),
        effectiveMonth: active.pendingEffectiveMonth,
      } : null,
      customPricingRecommended: recommendationCallCount >= 1001,
      paymentMethodLabel: text(accountSettings.PaymentMethodLabel || business.paymentMethodLabel),
      stripeStatus: stripe.status,
      stripeCallsSynced: stripe.synced,
      availablePlans: RECEPTIONIST_PLANS.map((plan) => receptionistPlanSnapshot(plan.key)),
    },
  };
}

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const result = await buildSummary(auth);
    if (result.response) return result.response;
    return NextResponse.json(result.summary);
  } catch (error) {
    console.error("Unable to load monthly receptionist billing summary", error);
    return NextResponse.json({ error: "Could not calculate this month's receptionist amount due." }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const requestedPlan = RECEPTIONIST_PLANS.find((plan) => plan.key === text(body.planKey));
    if (!requestedPlan) {
      return NextResponse.json({ error: "Choose a valid receptionist plan." }, { status: 400 });
    }

    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(auth.clientId);
    const accountRef = db.collection("accounts").doc(auth.decodedToken.uid);
    const accountSettingsRef = db.collection("ocmClients").doc(auth.clientId).collection("settings").doc("account");
    const receptionistRef = db.collection("ocmClients").doc(auth.clientId).collection("settings").doc("receptionist");
    const [businessSnapshot, receptionistSnapshot] = await Promise.all([
      businessRef.get(),
      receptionistRef.get(),
    ]);
    if (!businessSnapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    const business = businessSnapshot.data();
    const currentPlan = getReceptionistPlan(business.receptionistPlanKey || DEFAULT_RECEPTIONIST_PLAN_KEY);
    const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "") || "America/New_York";
    const currentMonthKey = monthKeyInTimeZone(new Date(), timeZone);
    const effectiveMonth = adjacentMonthKey(currentMonthKey, 1);

    if (requestedPlan.key === currentPlan.key) {
      await Promise.all([
        businessRef.set({
          pendingReceptionistPlanKey: FieldValue.delete(),
          pendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        accountRef.set({
          pendingReceptionistPlanKey: FieldValue.delete(),
          pendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        accountSettingsRef.set({
          PendingReceptionistPlanKey: FieldValue.delete(),
          PendingReceptionistPlanEffectiveMonth: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
      ]);
    } else {
      await Promise.all([
        businessRef.set({
          pendingReceptionistPlanKey: requestedPlan.key,
          pendingReceptionistPlanEffectiveMonth: effectiveMonth,
          receptionistPlanSelectionUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        accountRef.set({
          pendingReceptionistPlanKey: requestedPlan.key,
          pendingReceptionistPlanEffectiveMonth: effectiveMonth,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        accountSettingsRef.set({
          PendingReceptionistPlanKey: requestedPlan.key,
          PendingReceptionistPlanName: requestedPlan.name,
          PendingReceptionistPlanEffectiveMonth: effectiveMonth,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
      ]);
    }

    const result = await buildSummary(auth);
    if (result.response) return result.response;
    return NextResponse.json({
      ...result.summary,
      message: requestedPlan.key === currentPlan.key
        ? "The pending plan change was removed."
        : `${requestedPlan.name} is scheduled for ${effectiveMonth}.`,
    });
  } catch (error) {
    console.error("Unable to schedule receptionist plan", error);
    return NextResponse.json({ error: "Could not schedule that receptionist plan." }, { status: 500 });
  }
}
