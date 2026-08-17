export const BILLING_VERSION = "usage-threshold-v1";
export const BILLING_PLAN_KEY = "standard";
export const MONTHLY_BASE_CENTS = 5000;
export const PER_LEAD_CENTS = 200;
export const PER_CHAT_CENTS = 0;
export const PER_MESSAGE_BUNDLE_CENTS = 100;
export const MESSAGE_PARTS_PER_BUNDLE = 50;
export const USAGE_CHARGE_THRESHOLD_POINTS = 20;
export const USAGE_POINT_CENTS = 100;
export const REFERRAL_DISCOUNT_PERCENT = 10;
export const MAX_ACTIVE_REFERRALS = 5;
export const MAX_REFERRAL_DISCOUNT_PERCENT = 50;
export const REFERRAL_DISCOUNT_DURATION_DAYS = 30;

function wholeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function smsUsageResult(remainderParts, addedParts) {
  const totalParts = wholeNumber(remainderParts) % MESSAGE_PARTS_PER_BUNDLE + wholeNumber(addedParts);
  return {
    addedPoints: Math.floor(totalParts / MESSAGE_PARTS_PER_BUNDLE),
    remainderParts: totalParts % MESSAGE_PARTS_PER_BUNDLE,
  };
}

export function usageThresholdResult(balancePoints, addedPoints) {
  const total = wholeNumber(balancePoints) + wholeNumber(addedPoints);
  const charges = Math.floor(total / USAGE_CHARGE_THRESHOLD_POINTS);
  return {
    totalPoints: total,
    chargeCount: charges,
    chargeDue: charges > 0,
    chargePoints: charges * USAGE_CHARGE_THRESHOLD_POINTS,
    remainderPoints: total % USAGE_CHARGE_THRESHOLD_POINTS,
  };
}

export function referralDiscountPercent(referralCount) {
  return Math.min(
    MAX_REFERRAL_DISCOUNT_PERCENT,
    wholeNumber(referralCount) * REFERRAL_DISCOUNT_PERCENT
  );
}

export function usageChargeAfterReferralDiscount(amountCents, discountPercent) {
  const amount = wholeNumber(amountCents);
  const discount = Math.min(MAX_REFERRAL_DISCOUNT_PERCENT, wholeNumber(discountPercent));
  return Math.max(0, Math.round(amount * (100 - discount) / 100));
}
