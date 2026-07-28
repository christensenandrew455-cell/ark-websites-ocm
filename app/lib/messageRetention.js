export const MESSAGE_RETENTION_OPTIONS = Object.freeze([0, 1, 7, 30]);

function text(value) {
  return String(value || "").trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function normalizeMessageRetentionDays(value) {
  const days = Number(value || 0);
  return MESSAGE_RETENTION_OPTIONS.includes(days) ? days : 0;
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
  if (!days) return 0;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const root = db.collection("ocmClients").doc(text(clientId));
  const snapshot = await root.collection("leadConversations").get();
  let deleted = 0;

  for (const conversation of snapshot.docs) {
    const data = conversation.data();
    const activityAt = toMillis(data.lastMessageAt || data.updatedAt || data.createdAt);
    if (!activityAt || activityAt >= cutoff) continue;
    await deleteLeadConversation(db, root, conversation.ref);
    deleted += 1;
  }

  return deleted;
}
