export const ACCOUNT_ROLES = Object.freeze({
  STANDARD: "standard",
});

export function isStandardRole(value) {
  return value === ACCOUNT_ROLES.STANDARD;
}
