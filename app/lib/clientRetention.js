import { timestampMillis } from "./estimateRequestLifecycle.js";

export const CLIENT_RETENTION_OPTIONS = Object.freeze([0, 1, 7, 30]);
export const DEFAULT_CLIENT_RETENTION_DAYS = 0;

function text(value) {
  return String(value || "").trim();
}

function nowMillis(now) {
  return now instanceof Date ? now.getTime() : Number(now);
}

export function normalizeClientRetentionDays(value) {
  const days = Number(value);
  return CLIENT_RETENTION_OPTIONS.includes(days) ? days : DEFAULT_CLIENT_RETENTION_DAYS;
}

export function clientRetentionCutoff(retentionDays, now = Date.now()) {
  const days = normalizeClientRetentionDays(retentionDays);
  const current = nowMillis(now);
  return days && Number.isFinite(current) ? current - days * 24 * 60 * 60 * 1000 : 0;
}

export function clientActivityAt(data = {}) {
  return timestampMillis(
    data.updatedAt
      || data.workStartedAt
      || data.movedAt
      || data.acceptedAt
      || data.createdAt
      || data.contactedAt
  );
}

export function isClientPastRetention(activityAt, retentionDays, now = Date.now()) {
  const activityMs = timestampMillis(activityAt);
  const cutoff = clientRetentionCutoff(retentionDays, now);
  return Boolean(activityMs && cutoff && activityMs <= cutoff);
}

export async function cleanupExpiredClients(db, clientId, retentionDays, now = Date.now()) {
  const days = normalizeClientRetentionDays(retentionDays);
  if (!days) return 0;

  const root = db.collection("accounts").doc(text(clientId));
  const snapshot = await root.collection("clients").get();
  let deleted = 0;
  for (const document of snapshot.docs) {
    if (!isClientPastRetention(clientActivityAt(document.data()), days, now)) continue;
    await document.ref.delete();
    deleted += 1;
  }
  return deleted;
}
