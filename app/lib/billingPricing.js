export const BILLING_VERSION = "one-account-usage-v7";
export const BILLING_PLAN_KEY = "standard";
export const BILLING_PLAN_NAME = "ARK AI Receptionist";
export const MONTHLY_BASE_CENTS = 5000;
export const PER_LEAD_CENTS = 200;
export const PER_CALL_CENTS = PER_LEAD_CENTS;
export const PER_CHAT_CENTS = 100;
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
  return Math.floor(count / MESSAGE_PARTS_PER_BUNDLE);
}

export function messagePartBlocksCrossed(partsBefore, partsThroughPeriod) {
  return Math.max(
    0,
    messageBundleCount(partsThroughPeriod) - messageBundleCount(partsBefore)
  );
}

export function referralDiscountPercent(referralCount) {
  return Math.min(
    MAX_REFERRAL_DISCOUNT_PERCENT,
    wholeNumber(referralCount) * REFERRAL_DISCOUNT_PERCENT
  );
}

export function calculateBillingSummary({
  leadCount,
  callCount = 0,
  chatCount = 0,
  messagePartCount = 0,
  messagePartBlockCount,
  messagePartRemainder = 0,
  messageCount = 0,
  employeeCount = 0,
  referralCount = 0,
} = {}) {
  const leads = wholeNumber(leadCount ?? callCount);
  const chats = wholeNumber(chatCount);
  const parts = wholeNumber(messagePartCount);
  const messages = wholeNumber(messageCount);
  const employees = wholeNumber(employeeCount);
  const referrals = Math.min(MAX_MONTHLY_REFERRALS, wholeNumber(referralCount));
  const blocks = messagePartBlockCount === undefined
    ? messageBundleCount(parts)
    : wholeNumber(messagePartBlockCount);
  const leadUsageCents = leads * PER_LEAD_CENTS;
  const chatUsageCents = chats * PER_CHAT_CENTS;
  const messagePartUsageCents = blocks * PER_MESSAGE_BUNDLE_CENTS;
  const messageUsageCents = chatUsageCents + messagePartUsageCents;
  const employeeUsageCents = employees * PER_EMPLOYEE_CENTS;
  const usageCents = leadUsageCents + messageUsageCents + employeeUsageCents;
  const subtotalCents = MONTHLY_BASE_CENTS + usageCents;
  const discountPercent = referralDiscountPercent(referrals);
  const referralSavingsCents = Math.round(subtotalCents * discountPercent / 100);
  return {
    billingPlan: BILLING_PLAN_KEY,
    planName: BILLING_PLAN_NAME,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    leadCount: leads,
    perLeadCents: PER_LEAD_CENTS,
    leadUsageCents,
    callCount: leads,
    perCallCents: PER_LEAD_CENTS,
    callUsageCents: leadUsageCents,
    chatCount: chats,
    perChatCents: PER_CHAT_CENTS,
    chatUsageCents,
    messageCount: messages,
    messagePartCount: parts,
    messageBundleCount: blocks,
    messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
    perMessagePartBlockCents: PER_MESSAGE_BUNDLE_CENTS,
    messagePartBlockCount: blocks,
    messagePartRemainder: wholeNumber(messagePartRemainder) % MESSAGE_PARTS_PER_BUNDLE,
    messagePartUsageCents,
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
