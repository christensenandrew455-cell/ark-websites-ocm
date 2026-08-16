const DAY_MS = 24 * 60 * 60 * 1000;

function millis(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function billingPaymentDeadline(status = {}) {
  const recoveryEndsAt = millis(status.recoveryEndsAt);
  if (recoveryEndsAt) return new Date(recoveryEndsAt).toISOString();
  const failureAt = millis(status.failureAt);
  if (failureAt) return new Date(failureAt + 7 * DAY_MS).toISOString();
  return "";
}
