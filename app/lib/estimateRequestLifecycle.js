export const DAY_MS = 24 * 60 * 60 * 1000;
export const ESTIMATE_REQUEST_FINAL_DAY_MS = 6 * DAY_MS;
export const ESTIMATE_REQUEST_EXPIRES_MS = 7 * DAY_MS;

export function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function estimateRequestLifecycle(createdAt, now = Date.now()) {
  const createdMs = timestampMillis(createdAt);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const ageMs = createdMs && Number.isFinite(nowMs) ? Math.max(0, nowMs - createdMs) : 0;

  return {
    ageMs,
    finalDay: Boolean(createdMs) && ageMs >= ESTIMATE_REQUEST_FINAL_DAY_MS && ageMs < ESTIMATE_REQUEST_EXPIRES_MS,
    expired: Boolean(createdMs) && ageMs >= ESTIMATE_REQUEST_EXPIRES_MS,
  };
}

export function estimateRequestCreatedAt(data = {}) {
  return timestampMillis(data.createdAt || data.contactedAt || data.updatedAt);
}
