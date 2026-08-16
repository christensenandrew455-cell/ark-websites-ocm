import { timestampMillis } from "./estimateRequestLifecycle.js";

export const LEAD_RETENTION_OPTIONS = Object.freeze([0, 1, 7, 30]);
export const DEFAULT_LEAD_RETENTION_DAYS = 0;

function text(value) {
  return String(value || "").trim();
}

function nowMillis(now) {
  return now instanceof Date ? now.getTime() : Number(now);
}

export function normalizeLeadRetentionDays(value) {
  const days = Number(value);
  return LEAD_RETENTION_OPTIONS.includes(days) ? days : DEFAULT_LEAD_RETENTION_DAYS;
}

export function retentionCutoff(retentionDays, now = Date.now()) {
  const days = normalizeLeadRetentionDays(retentionDays);
  const current = nowMillis(now);
  return days && Number.isFinite(current) ? current - days * 24 * 60 * 60 * 1000 : 0;
}

export function leadActivityAt(data = {}) {
  return timestampMillis(data.updatedAt || data.acceptedAt || data.createdAt || data.contactedAt);
}

export function isPastRetention(activityAt, retentionDays, now = Date.now()) {
  const activityMs = timestampMillis(activityAt);
  const cutoff = retentionCutoff(retentionDays, now);
  return Boolean(activityMs && cutoff && activityMs <= cutoff);
}

export async function cleanupExpiredLeads(db, clientId, retentionDays, now = Date.now()) {
  const days = normalizeLeadRetentionDays(retentionDays);
  if (!days) return 0;

  const root = db.collection("accounts").doc(text(clientId));
  let deleted = 0;
  for (const collectionKey of ["contactedMe", "clients"]) {
    const snapshot = await root.collection(collectionKey).get();
    for (const document of snapshot.docs) {
      if (!isPastRetention(leadActivityAt(document.data()), days, now)) continue;
      await document.ref.delete();
      deleted += 1;
    }
  }
  return deleted;
}
