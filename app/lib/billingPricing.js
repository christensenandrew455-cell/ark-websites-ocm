export const BILLING_VERSION = "monthly-call-plans-v3";
export const DEFAULT_BILLING_PLAN_KEY = "starter";

export const BILLING_PLANS = Object.freeze({
  starter: Object.freeze({
    key: "starter",
    name: "Starter",
    monthlyCalls: 50,
    amountCents: 4_999,
  }),
  standard: Object.freeze({
    key: "standard",
    name: "Standard",
    monthlyCalls: 100,
    amountCents: 7_999,
  }),
  growth: Object.freeze({
    key: "growth",
    name: "Growth",
    monthlyCalls: 250,
    amountCents: 14_999,
  }),
  pro: Object.freeze({
    key: "pro",
    name: "Pro",
    monthlyCalls: 500,
    amountCents: 29_999,
  }),
});

export const BILLING_PLAN_KEYS = Object.freeze(Object.keys(BILLING_PLANS));

function wholeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function normalizeBillingPlanKey(value, fallback = DEFAULT_BILLING_PLAN_KEY) {
  const candidate = String(value || "").trim().toLowerCase();
  if (Object.hasOwn(BILLING_PLANS, candidate)) return candidate;
  const safeFallback = String(fallback || "").trim().toLowerCase();
  return Object.hasOwn(BILLING_PLANS, safeFallback) ? safeFallback : DEFAULT_BILLING_PLAN_KEY;
}

export function billingPlan(value = DEFAULT_BILLING_PLAN_KEY) {
  return BILLING_PLANS[normalizeBillingPlanKey(value)];
}

export function billingPlanForAmount(amountCents) {
  const amount = wholeNumber(amountCents);
  return BILLING_PLAN_KEYS.map((key) => BILLING_PLANS[key])
    .find((plan) => plan.amountCents === amount) || null;
}

export function publicBillingPlans() {
  return BILLING_PLAN_KEYS.map((key) => ({ ...BILLING_PLANS[key] }));
}
