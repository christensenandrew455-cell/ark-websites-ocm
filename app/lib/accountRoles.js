export const ACCOUNT_ROLES = Object.freeze({
  ADMIN: "admin",
  STANDARD: "standard",
});

export function isStandardRole(value) {
  return value === ACCOUNT_ROLES.STANDARD;
}
