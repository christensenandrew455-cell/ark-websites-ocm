import { isStandardRole } from "./accountRoles.js";

export const ACCOUNT_VERIFICATION_DEADLINE_MS = 60 * 60 * 1000;

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const time = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function newAccountVerificationDeadline(now = Date.now()) {
  const start = timestampMs(now) || Date.now();
  return new Date(start + ACCOUNT_VERIFICATION_DEADLINE_MS);
}

export function accountVerificationDeadline(account = {}) {
  const explicit = timestampMs(account.identityVerificationDeadlineAt);
  if (explicit) return new Date(explicit);
  const started = timestampMs(account.activatedAt) || timestampMs(account.createdAt);
  return started ? new Date(started + ACCOUNT_VERIFICATION_DEADLINE_MS) : null;
}

export function ownerAccountNeedsIdentityVerification(account = {}) {
  return isStandardRole(account.role)
    && account.identityVerificationRequired === true
    && account.identityVerificationVerified !== true;
}

export function accountVerificationExpired(account = {}, now = Date.now()) {
  if (!ownerAccountNeedsIdentityVerification(account)) return false;
  const deadline = accountVerificationDeadline(account);
  const current = timestampMs(now) || Date.now();
  return Boolean(deadline && deadline.getTime() <= current);
}
