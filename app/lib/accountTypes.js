export const ACCOUNT_TYPES = Object.freeze({
  OWNER: "owner",
});

export function normalizePersonKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function accountTypeForBillingPlan() {
  return ACCOUNT_TYPES.OWNER;
}

export function isBusinessAccountType(value) {
  return value === ACCOUNT_TYPES.OWNER;
}
