export const BILLING_VERSION = "one-account-usage-v5";
export const BILLING_PLAN_KEY = "standard";
export const BILLING_PLAN_NAME = "ARK AI Receptionist";
export const MONTHLY_BASE_CENTS = 5000;
export const PER_CALL_CENTS = 200;
export const PER_MESSAGE_BUNDLE_CENTS = 100;
export const MESSAGE_PARTS_PER_BUNDLE = 50;
export const PER_EMPLOYEE_CENTS = 500;
export const REFERRAL_DISCOUNT_PERCENT = 10;
export const MAX_MONTHLY_REFERRALS = 5;
export const MAX_REFERRAL_DISCOUNT_PERCENT = 50;

function wholeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function messageBundleCount(parts) {
  const count = wholeNumber(parts);
  return count === 0 ? 0 : Math.ceil(count / MESSAGE_PARTS_PER_BUNDLE);
}

export function referralDiscountPercent(referralCount) {
  return Math.min(
    MAX_REFERRAL_DISCOUNT_PERCENT,
    wholeNumber(referralCount) * REFERRAL_DISCOUNT_PERCENT
  );
}

export function calculateBillingSummary({
  callCount = 0,
  messagePartCount = 0,
  messageCount = 0,
  employeeCount = 0,
  referralCount = 0,
} = {}) {
  const calls = wholeNumber(callCount);
  const parts = wholeNumber(messagePartCount);
  const messages = wholeNumber(messageCount);
  const employees = wholeNumber(employeeCount);
  const referrals = Math.min(MAX_MONTHLY_REFERRALS, wholeNumber(referralCount));
  const bundles = messageBundleCount(parts);
  const callUsageCents = calls * PER_CALL_CENTS;
  const messageUsageCents = bundles * PER_MESSAGE_BUNDLE_CENTS;
  const employeeUsageCents = employees * PER_EMPLOYEE_CENTS;
  const usageCents = callUsageCents + messageUsageCents + employeeUsageCents;
  const subtotalCents = MONTHLY_BASE_CENTS + usageCents;
  const discountPercent = referralDiscountPercent(referrals);
  const referralSavingsCents = Math.round(subtotalCents * discountPercent / 100);
  return {
    billingPlan: BILLING_PLAN_KEY,
    planName: BILLING_PLAN_NAME,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    callCount: calls,
    perCallCents: PER_CALL_CENTS,
    callUsageCents,
    messageCount: messages,
    messagePartCount: parts,
    messageBundleCount: bundles,
    messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
    messageUsageCents,
    employeeCount: employees,
    perEmployeeCents: PER_EMPLOYEE_CENTS,
    employeeUsageCents,
    usageCents,
    subtotalCents,
    referralCount: referrals,
    referralDiscountPercent: discountPercent,
    referralSavingsCents,
    amountDue: Math.max(0, subtotalCents - referralSavingsCents),
    currency: "usd",
  };
}
