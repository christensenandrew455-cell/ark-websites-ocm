// Temporary launch controls live here so retired features stay centralized.
// The website offer is closed to every new signup. Its historical key remains
// recognized only so an already-created discounted subscription or pending
// payment keeps the price the owner previously accepted.
export const TEMPORARY_FEATURES = Object.freeze({
  webLaunchOffer: Object.freeze({
    acceptingNewAccounts: false,
    key: "web-launch-half-off-v1",
    label: "Website launch offer",
    percentOff: 50,
    stripeCouponId: "ark_web_launch_half_off_v1",
  }),
  feedback: Object.freeze({
    enabled: true,
  }),
});

const NATIVE_APP_USER_AGENT_MARKER = "ARKClientCenter/";

function whole(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function billingPromotion(value) {
  const key = String(value || "").trim();
  return key === TEMPORARY_FEATURES.webLaunchOffer.key
    ? TEMPORARY_FEATURES.webLaunchOffer
    : null;
}

export function activeWebLaunchOffer() {
  return TEMPORARY_FEATURES.webLaunchOffer.acceptingNewAccounts
    ? TEMPORARY_FEATURES.webLaunchOffer
    : null;
}

export function isNativeClientCenterRequest(request) {
  const userAgent = String(request?.headers?.get?.("user-agent") || "");
  return userAgent.includes(NATIVE_APP_USER_AGENT_MARKER);
}

export function webSignupPromotionForRequest(request, existingPromotionKey = "") {
  const existing = billingPromotion(existingPromotionKey);
  if (existing) return existing;
  if (isNativeClientCenterRequest(request)) return null;
  return activeWebLaunchOffer();
}

export function discountedAmountCents(amountCents, promotionOrKey = "") {
  const amount = whole(amountCents);
  const promotion = typeof promotionOrKey === "object"
    ? promotionOrKey
    : billingPromotion(promotionOrKey);
  if (!promotion) return amount;
  return Math.round(amount * (100 - promotion.percentOff) / 100);
}

export function publicPromotion(promotionOrKey = "") {
  const promotion = typeof promotionOrKey === "object"
    ? promotionOrKey
    : billingPromotion(promotionOrKey);
  if (!promotion) return null;
  return {
    key: promotion.key,
    label: promotion.label,
    percentOff: promotion.percentOff,
    renewsAtDiscount: true,
  };
}

export function promotionBillingFields(plan, promotionOrKey = "") {
  const promotion = typeof promotionOrKey === "object"
    ? promotionOrKey
    : billingPromotion(promotionOrKey);
  return {
    billingPromotionKey: promotion?.key || "",
    billingDiscountPercent: promotion?.percentOff || 0,
    billingSalesChannel: promotion ? "web" : "",
    monthlyPlanListAmountCents: whole(plan?.amountCents),
    monthlyPlanAmountCents: discountedAmountCents(plan?.amountCents, promotion),
  };
}
