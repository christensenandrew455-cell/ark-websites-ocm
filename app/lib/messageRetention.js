export const MESSAGE_RETENTION_OPTIONS = Object.freeze([0, 1, 7, 30]);
export const DEFAULT_MESSAGE_RETENTION_DAYS = 0;

function text(value) {
  return String(value || "").trim();
}

export function messageTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function messageRetentionCutoff(retentionDays, now = Date.now()) {
  const days = normalizeMessageRetentionDays(retentionDays);
  const current = now instanceof Date ? now.getTime() : Number(now);
  return days && Number.isFinite(current) ? current - days * 24 * 60 * 60 * 1000 : 0;
}

export function isConversationPastRetention(data = {}, retentionDays, now = Date.now()) {
  const activityAt = messageTimestampMillis(data.lastMessageAt || data.updatedAt || data.createdAt);
  const cutoff = messageRetentionCutoff(retentionDays, now);
  return Boolean(activityAt && cutoff && activityAt <= cutoff);
}

export function normalizeMessageRetentionDays(value) {
  const days = Number(value);
  return MESSAGE_RETENTION_OPTIONS.includes(days) ? days : DEFAULT_MESSAGE_RETENTION_DAYS;
}

async function deleteQuery(db, query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

export async function deleteLeadConversation(db, root, conversationRef) {
  await deleteQuery(db, conversationRef.collection("messages"));
  await deleteQuery(db, root.collection("telnyxMessageIndex").where("conversationId", "==", conversationRef.id));
  await conversationRef.delete();
}

export async function cleanupExpiredConversations(db, clientId, retentionDays, now = Date.now()) {
  const days = normalizeMessageRetentionDays(retentionDays);
  if (days === 0) return 0;
  const root = db.collection("accounts").doc(text(clientId));
  const snapshot = await root.collection("leadConversations").get();
  let deleted = 0;

  for (const conversation of snapshot.docs) {
    if (!isConversationPastRetention(conversation.data(), days, now)) continue;
    await deleteLeadConversation(db, root, conversation.ref);
    deleted += 1;
  }

  return deleted;
}
