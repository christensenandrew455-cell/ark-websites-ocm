export const ACCOUNT_TYPES = Object.freeze({
  SOLO_OWNER: "solo_owner",
  BUSINESS_OWNER: "business_owner",
  BUSINESS_EMPLOYEE: "business_employee",
});

export const DEFAULT_EMPLOYEE_VISIBILITY = Object.freeze({
  name: true,
  phone: false,
  email: false,
  address: true,
  job: true,
  requestedTime: true,
  notes: true,
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

export function normalizeEmployeeVisibility(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_EMPLOYEE_VISIBILITY).map(([key, fallback]) => [
      key,
      typeof value?.[key] === "boolean" ? value[key] : fallback,
    ])
  );
}

export function accountTypeForBillingPlan(plan) {
  return String(plan || "").trim().toLowerCase() === "business"
    ? ACCOUNT_TYPES.BUSINESS_OWNER
    : ACCOUNT_TYPES.SOLO_OWNER;
}

export function isBusinessAccountType(value) {
  return value === ACCOUNT_TYPES.BUSINESS_OWNER || value === ACCOUNT_TYPES.BUSINESS_EMPLOYEE;
}
