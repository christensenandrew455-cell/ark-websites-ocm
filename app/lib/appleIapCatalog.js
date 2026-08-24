import { MONTHLY_BASE_CENTS, USAGE_CHARGE_THRESHOLD_POINTS, USAGE_POINT_CENTS, usageChargeAfterReferralDiscount } from "./billingPricing.js";

export const APPLE_IAP_BUNDLE_ID = String(process.env.APPLE_IAP_BUNDLE_ID || "com.arkwebsites.clientcenter").trim();
export const APPLE_IAP_BASE_PRODUCT_ID = String(process.env.APPLE_IAP_BASE_PRODUCT_ID || `${APPLE_IAP_BUNDLE_ID}.base.monthly`).trim();
export const APPLE_IAP_DISCOUNT_LEVELS = Object.freeze([0, 10, 20, 30, 40, 50]);

function envUsageProduct(discountPercent) {
  return String(process.env[`APPLE_IAP_USAGE_PRODUCT_ID_${discountPercent}`] || `${APPLE_IAP_BUNDLE_ID}.usage20.referral${discountPercent}`).trim();
}

export const APPLE_IAP_USAGE_PRODUCTS = Object.freeze(Object.fromEntries(
  APPLE_IAP_DISCOUNT_LEVELS.map((discountPercent) => [discountPercent, envUsageProduct(discountPercent)]),
));

export function appleUsageDiscountLevel(value) {
  const percent = Math.max(0, Math.min(50, Math.floor(Number(value || 0) / 10) * 10));
  return APPLE_IAP_DISCOUNT_LEVELS.includes(percent) ? percent : 0;
}

export function appleUsageProduct(discountPercent = 0) {
  const level = appleUsageDiscountLevel(discountPercent);
  return {
    productId: APPLE_IAP_USAGE_PRODUCTS[level],
    discountPercent: level,
    amountCents: usageChargeAfterReferralDiscount(USAGE_CHARGE_THRESHOLD_POINTS * USAGE_POINT_CENTS, level),
  };
}

export function appleIapCatalog() {
  return {
    bundleId: APPLE_IAP_BUNDLE_ID,
    base: { productId: APPLE_IAP_BASE_PRODUCT_ID, amountCents: MONTHLY_BASE_CENTS, period: "month" },
    usage: APPLE_IAP_DISCOUNT_LEVELS.map(appleUsageProduct),
  };
}

export function isAppleUsageProduct(productId) {
  return Object.values(APPLE_IAP_USAGE_PRODUCTS).includes(String(productId || "").trim());
}
