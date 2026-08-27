import {
  BILLING_PLAN_KEYS,
  billingPlan,
  normalizeBillingPlanKey,
} from "./billingPricing.js";

export const APPLE_IAP_BUNDLE_ID = "com.arkwebsites.app";

function environmentProductId(planKey) {
  const key = normalizeBillingPlanKey(planKey);
  const environmentKey = `APPLE_IAP_PLAN_PRODUCT_ID_${key.toUpperCase()}`;
  return String(process.env[environmentKey] || `${APPLE_IAP_BUNDLE_ID}.${key}.monthly`).trim();
}

export const APPLE_IAP_PLAN_PRODUCTS = Object.freeze(Object.fromEntries(
  BILLING_PLAN_KEYS.map((planKey) => [planKey, environmentProductId(planKey)]),
));

export function applePlanProduct(planKey = "starter") {
  const plan = billingPlan(planKey);
  return {
    ...plan,
    productId: APPLE_IAP_PLAN_PRODUCTS[plan.key],
    period: "month",
  };
}

export function applePlanForProduct(productId) {
  const expected = String(productId || "").trim();
  const planKey = BILLING_PLAN_KEYS.find((key) => APPLE_IAP_PLAN_PRODUCTS[key] === expected);
  return planKey ? applePlanProduct(planKey) : null;
}

export function appleIapCatalog() {
  return {
    bundleId: APPLE_IAP_BUNDLE_ID,
    plans: BILLING_PLAN_KEYS.map(applePlanProduct),
  };
}

export function isApplePlanProduct(productId) {
  return Boolean(applePlanForProduct(productId));
}
