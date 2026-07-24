export const ACCOUNT_TYPES = Object.freeze({
  OWNER: "owner",
  EMPLOYEE: "employee",
  // Compatibility aliases for records and imports created by the old plan model.
  SOLO_OWNER: "owner",
  BUSINESS_OWNER: "owner",
  BUSINESS_EMPLOYEE: "employee",
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

export function accountTypeForBillingPlan() {
  return ACCOUNT_TYPES.OWNER;
}

export function isBusinessAccountType(value) {
  return value === ACCOUNT_TYPES.OWNER || value === ACCOUNT_TYPES.EMPLOYEE;
}
