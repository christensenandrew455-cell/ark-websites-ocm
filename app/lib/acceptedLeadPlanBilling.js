import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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

function planLimit(plan) {
  return Math.max(1, whole(plan.monthlyAcceptedLeads ?? plan.monthlyCalls));
}

export function acceptedLeadEventDocumentId(clientId, periodKey, leadId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(periodKey)}:${text(leadId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function acceptedLeadEventRef(db, { clientId, periodKey, leadId }) {
  return db.collection("accounts").doc(text(clientId)).collection("acceptedLeadEvents")
    .doc(acceptedLeadEventDocumentId(clientId, periodKey, leadId));
}

export function accountAcceptedLeadPeriod(account = {}, from = new Date()) {
  const now = from instanceof Date ? from.getTime() : Number(from);
  const startMs = millis(account.acceptedLeadPeriodStartAt || account.callPeriodStartAt);
  const endMs = millis(account.acceptedLeadPeriodEndAt || account.callPeriodEndAt);
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

export function acceptedLeadPlanStatus(account = {}, from = new Date(), minimumAcceptedLeadsUsed = 0) {
  const planKey = normalizeBillingPlanKey(account.billingPlanKey || account.billingPlan);
  const plan = billingPlan(planKey);
  const monthlyAcceptedLeadLimit = planLimit(plan);
  const promotion = billingPromotion(account.billingPromotionKey);
  const storedMonthlyPrice = whole(account.monthlyPlanAmountCents);
  const monthlyListPriceCents = whole(account.monthlyPlanListAmountCents) || plan.amountCents;
  const period = accountAcceptedLeadPeriod(account, from);
  const storedPeriodKey = text(account.acceptedLeadPeriodKey);
  const storedUsed = storedPeriodKey === period.key ? whole(account.acceptedLeadsUsedThisPeriod) : 0;
  const storedTopUpPeriodKey = text(account.acceptedLeadTopUpPeriodKey);
  const acceptedLeadTopUps = storedTopUpPeriodKey === period.key
    ? whole(account.acceptedLeadTopUpsThisPeriod)
    : 0;
  const acceptedLeadPeriodLimit = monthlyAcceptedLeadLimit + acceptedLeadTopUps;
  const acceptedLeadsUsed = Math.max(storedUsed, whole(minimumAcceptedLeadsUsed));
  const acceptedLeadsRemaining = Math.max(0, acceptedLeadPeriodLimit - acceptedLeadsUsed);
  return {
    planKey,
    planName: plan.name,
    planPositioning: plan.positioning,
    baseMonthlyPriceCents: plan.amountCents,
    monthlyValueCents: plan.listAmountCents,
    volumeSavingsPercent: plan.savingsPercent,
    monthlyPriceCents: storedMonthlyPrice || discountedAmountCents(plan.amountCents, promotion),
    monthlyListPriceCents,
    billingPromotionKey: promotion?.key || "",
    billingDiscountPercent: promotion?.percentOff || 0,
    monthlyAcceptedLeadLimit,
    acceptedLeadTopUps,
    acceptedLeadPeriodLimit,
    acceptedLeadsUsed,
    acceptedLeadsRemaining,
    progressPercent: Math.min(100, acceptedLeadsUsed / acceptedLeadPeriodLimit * 100),
    limitReached: acceptedLeadsRemaining === 0,
    periodKey: period.key,
    periodStartAt: new Date(period.startMs).toISOString(),
    periodEndAt: new Date(period.endMs).toISOString(),
  };
}

export function nextAcceptedLeadPlanStatus(account = {}, {
  existingAcceptedCount = 0,
  from = new Date(),
  increment = true,
} = {}) {
  const current = acceptedLeadPlanStatus(account, from, existingAcceptedCount);
  const acceptedLeadsUsed = current.acceptedLeadsUsed + (increment ? 1 : 0);
  const acceptedLeadsRemaining = Math.max(0, current.acceptedLeadPeriodLimit - acceptedLeadsUsed);
  return {
    ...current,
    acceptedLeadsUsed,
    acceptedLeadsRemaining,
    progressPercent: Math.min(100, acceptedLeadsUsed / current.acceptedLeadPeriodLimit * 100),
    limitReached: acceptedLeadsRemaining === 0,
  };
}

export function acceptedLeadAccountPatch(status, acceptedAt = null) {
  return {
    billingPlanKey: status.planKey,
    billingPlanName: status.planName,
    monthlyAcceptedLeadLimit: status.monthlyAcceptedLeadLimit,
    acceptedLeadPeriodLimit: status.acceptedLeadPeriodLimit,
    acceptedLeadPeriodKey: status.periodKey,
    acceptedLeadPeriodStartAt: Timestamp.fromDate(new Date(status.periodStartAt)),
    acceptedLeadPeriodEndAt: Timestamp.fromDate(new Date(status.periodEndAt)),
    acceptedLeadsUsedThisPeriod: status.acceptedLeadsUsed,
    acceptedLeadsRemainingThisPeriod: status.acceptedLeadsRemaining,
    acceptedLeadTopUpPeriodKey: status.periodKey,
    acceptedLeadTopUpsThisPeriod: status.acceptedLeadTopUps,
    acceptedLeadLimitReached: status.limitReached,
    ...(acceptedAt ? { lastAcceptedLeadAt: acceptedAt } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function acceptedLeadEventData({ clientId, leadId, status, acceptedAt = FieldValue.serverTimestamp() }) {
  return {
    clientId: text(clientId),
    leadId: text(leadId),
    billingPlanKey: status.planKey,
    acceptedLeadPeriodKey: status.periodKey,
    acceptedLeadNumberInPeriod: status.acceptedLeadsUsed,
    acceptedAt,
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function countAcceptedClientsInPeriod(accountRef, status) {
  const startAt = Timestamp.fromDate(new Date(status.periodStartAt));
  const endAt = Timestamp.fromDate(new Date(status.periodEndAt));
  const count = await accountRef.collection("clients")
    .where("acceptedAt", ">=", startAt)
    .where("acceptedAt", "<", endAt)
    .count()
    .get();
  return whole(count.data().count);
}

export function publicAcceptedLeadPlanSummary(account = {}, from = new Date(), minimumAcceptedLeadsUsed = 0) {
  const status = acceptedLeadPlanStatus(account, from, minimumAcceptedLeadsUsed);
  const promotion = billingPromotion(status.billingPromotionKey);
  return {
    ...status,
    plans: publicBillingPlans().map((plan) => ({
      key: plan.key,
      name: plan.name,
      positioning: plan.positioning,
      amountCents: plan.amountCents,
      listAmountCents: plan.listAmountCents,
      savingsPercent: plan.savingsPercent,
      monthlyAcceptedLeads: planLimit(plan),
      ...(promotion ? {
        promotionalAmountCents: discountedAmountCents(plan.amountCents, promotion),
      } : {}),
    })),
  };
}
