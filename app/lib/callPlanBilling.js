import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { acceptedLeadPlanStatus } from "./acceptedLeadPlanBilling.js";
import { billingPlan, normalizeBillingPlanKey, publicBillingPlans } from "./billingPricing.js";
import { billingPromotion, discountedAmountCents } from "./temporaryFeatures.js";
import { calendarMonthWindow } from "./timeWindows.js";

function text(value) {
  return String(value || "").trim();
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function callEventDocumentId(clientId, callId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(callId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function accountCallPeriod(account = {}, from = new Date()) {
  const now = from instanceof Date ? from.getTime() : Number(from);
  const startMs = millis(account.callPeriodStartAt);
  const endMs = millis(account.callPeriodEndAt);
  // Provider billing windows are authoritative. If a renewal webhook is late,
  // keep the completed period instead of inventing a calendar window that could
  // reset the allowance twice when the provider update eventually arrives.
  if (startMs > 0 && endMs > startMs && now >= startMs) {
    return {
      key: `${startMs}-${endMs}`,
      startMs,
      endMs,
      timeZone: text(account.timeZone) || "America/New_York",
    };
  }

  const calendar = calendarMonthWindow(text(account.timeZone), new Date(now));
  return {
    key: `calendar-${calendar.monthKey}`,
    startMs: calendar.startMs,
    endMs: calendar.endMs,
    timeZone: calendar.timeZone,
  };
}

export function callPlanStatus(account = {}, from = new Date()) {
  const planKey = normalizeBillingPlanKey(account.billingPlanKey || account.billingPlan);
  const plan = billingPlan(planKey);
  const promotion = billingPromotion(account.billingPromotionKey);
  const storedMonthlyPrice = whole(account.monthlyPlanAmountCents);
  const monthlyListPriceCents = whole(account.monthlyPlanListAmountCents) || plan.amountCents;
  const period = accountCallPeriod(account, from);
  const storedPeriodKey = text(account.callPeriodKey);
  const callsUsed = storedPeriodKey === period.key ? whole(account.callsUsedThisPeriod) : 0;
  const callsRemaining = Math.max(0, plan.monthlyCalls - callsUsed);
  return {
    planKey,
    planName: plan.name,
    monthlyPriceCents: storedMonthlyPrice || discountedAmountCents(plan.amountCents, promotion),
    monthlyListPriceCents,
    billingPromotionKey: promotion?.key || "",
    billingDiscountPercent: promotion?.percentOff || 0,
    monthlyCallLimit: plan.monthlyCalls,
    callsUsed,
    callsRemaining,
    progressPercent: Math.min(100, callsUsed / plan.monthlyCalls * 100),
    limitReached: callsRemaining === 0,
    periodKey: period.key,
    periodStartAt: new Date(period.startMs).toISOString(),
    periodEndAt: new Date(period.endMs).toISOString(),
  };
}

export function publicCallPlanSummary(account = {}, from = new Date()) {
  const status = callPlanStatus(account, from);
  const promotion = billingPromotion(status.billingPromotionKey);
  return {
    ...status,
    plans: publicBillingPlans().map((plan) => ({
      ...plan,
      ...(promotion ? {
        listAmountCents: plan.amountCents,
        promotionalAmountCents: discountedAmountCents(plan.amountCents, promotion),
      } : {}),
    })),
  };
}

export async function recordCompletedCall({
  db,
  clientId,
  callId,
  occurredAt = Date.now(),
  durationSeconds = 0,
  outcome = "",
  leadSaved = false,
}) {
  const safeClientId = text(clientId);
  const safeCallId = text(callId);
  if (!safeClientId || !safeCallId) throw new Error("CALL_ID_REQUIRED");

  const accountRef = db.collection("accounts").doc(safeClientId);
  const eventRef = accountRef.collection("callEvents").doc(callEventDocumentId(safeClientId, safeCallId));
  const eventTime = Number.isFinite(Number(occurredAt)) ? Number(occurredAt) : Date.now();

  return db.runTransaction(async (transaction) => {
    const [accountSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(eventRef),
    ]);
    if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    const account = accountSnapshot.data();
    const current = acceptedLeadPlanStatus(account, new Date());
    if (eventSnapshot.exists) {
      return { ...current, duplicate: true, callEventId: eventRef.id };
    }
    if (account.status !== "active" || account.billingPastDue === true) throw new Error("ACCOUNT_NOT_ACTIVE");

    const result = {
      ...current,
      duplicate: false,
      callEventId: eventRef.id,
    };

    transaction.create(eventRef, {
      callId: safeCallId,
      clientId: safeClientId,
      billingPlanKey: current.planKey,
      acceptedLeadPeriodKey: current.periodKey,
      callPeriodKey: current.periodKey,
      durationSeconds: whole(durationSeconds),
      outcome: text(outcome).slice(0, 80),
      leadSaved: leadSaved === true,
      occurredAt: Timestamp.fromMillis(eventTime),
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(accountRef, {
      lastCallAt: Timestamp.fromMillis(eventTime),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
  });
}
