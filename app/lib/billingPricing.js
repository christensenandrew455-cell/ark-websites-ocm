export const BILLING_VERSION = "monthly-accepted-lead-plans-v5";
export const DEFAULT_BILLING_PLAN_KEY = "starter";

export const BILLING_PLANS = Object.freeze({
  starter: Object.freeze({
    key: "starter",
    name: "Starter",
    positioning: "Just getting going",
    monthlyAcceptedLeads: 25,
    monthlyCalls: 25,
    listAmountCents: 2_500,
    amountCents: 2_499,
    savingsPercent: 0,
  }),
  standard: Object.freeze({
    key: "standard",
    name: "Standard",
    positioning: "Established small business",
    monthlyAcceptedLeads: 50,
    monthlyCalls: 50,
    listAmountCents: 5_000,
    amountCents: 4_749,
    savingsPercent: 5,
  }),
  growth: Object.freeze({
    key: "growth",
    name: "Growth",
    positioning: "Higher-volume business",
    monthlyAcceptedLeads: 100,
    monthlyCalls: 100,
    listAmountCents: 10_000,
    amountCents: 8_999,
    savingsPercent: 10,
  }),
  scale: Object.freeze({
    key: "scale",
    name: "Scale",
    positioning: "Very high lead volume",
    monthlyAcceptedLeads: 200,
    monthlyCalls: 200,
    listAmountCents: 20_000,
    amountCents: 16_999,
    savingsPercent: 15,
  }),
});

export const BILLING_PLAN_KEYS = Object.freeze(Object.keys(BILLING_PLANS));

const LEGACY_PLAN_ALIASES = Object.freeze({ pro: "scale" });
const LEGACY_PLAN_AMOUNTS = Object.freeze({
  4_999: "starter",
  7_999: "standard",
  14_999: "growth",
  29_999: "scale",
});

function wholeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function normalizeBillingPlanKey(value, fallback = DEFAULT_BILLING_PLAN_KEY) {
  const candidate = String(value || "").trim().toLowerCase();
  if (Object.hasOwn(BILLING_PLANS, candidate)) return candidate;
  if (Object.hasOwn(LEGACY_PLAN_ALIASES, candidate)) return LEGACY_PLAN_ALIASES[candidate];
  const safeFallback = String(fallback || "").trim().toLowerCase();
  if (Object.hasOwn(BILLING_PLANS, safeFallback)) return safeFallback;
  if (Object.hasOwn(LEGACY_PLAN_ALIASES, safeFallback)) return LEGACY_PLAN_ALIASES[safeFallback];
  return DEFAULT_BILLING_PLAN_KEY;
}

export function isBillingPlanKey(value) {
  const candidate = String(value || "").trim().toLowerCase();
  return Object.hasOwn(BILLING_PLANS, candidate) || Object.hasOwn(LEGACY_PLAN_ALIASES, candidate);
}

export function billingPlan(value = DEFAULT_BILLING_PLAN_KEY) {
  return BILLING_PLANS[normalizeBillingPlanKey(value)];
}

export function billingPlanForAmount(amountCents) {
  const amount = wholeNumber(amountCents);
  const current = BILLING_PLAN_KEYS.map((key) => BILLING_PLANS[key])
    .find((plan) => plan.amountCents === amount);
  if (current) return current;
  const legacyPlanKey = LEGACY_PLAN_AMOUNTS[amount];
  return legacyPlanKey ? BILLING_PLANS[legacyPlanKey] : null;
}

export function publicBillingPlans() {
  return BILLING_PLAN_KEYS.map((key) => ({ ...BILLING_PLANS[key] }));
}
