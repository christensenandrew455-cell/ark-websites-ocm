const DAY_MS = 24 * 60 * 60 * 1000;

function millis(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function billingPaymentDeadline(status = {}) {
  const explicitDeadline = millis(status.graceEndsAt);
  if (explicitDeadline) return new Date(explicitDeadline).toISOString();

  const offenseNumber = Math.max(1, Number(status.offenseNumber || 1));
  const quietEndsAt = millis(status.quietEndsAt);
  if (quietEndsAt) return new Date(quietEndsAt + (offenseNumber === 1 ? 7 * DAY_MS : 0)).toISOString();

  const failureAt = millis(status.failureAt);
  if (failureAt) return new Date(failureAt + (offenseNumber === 1 ? 8 * DAY_MS : DAY_MS)).toISOString();

  const reviewAt = millis(status.reviewAt);
  if (reviewAt) return new Date(reviewAt - (offenseNumber >= 3 ? 0 : 7 * DAY_MS)).toISOString();
  return "";
}
