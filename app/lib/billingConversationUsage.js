import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { billingTimestampMillis } from "./billingMessageUsage.js";

function text(value) { return String(value || "").trim(); }

export function billingConversationEventId(clientId, sourceId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(sourceId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function billingConversationEventRef(db, { clientId, sourceId }) {
  return db.collection("ocmClients").doc(clientId).collection("billingConversationEvents")
    .doc(billingConversationEventId(clientId, sourceId));
}

export function billingConversationEventData({ conversationId, sourceId, occurredAt, sourceType = "chat-created" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    conversationId: text(conversationId),
    sourceIdHash: createHash("sha256").update(text(sourceId)).digest("hex"),
    sourceType: text(sourceType) || "chat-created",
    occurredAt: millis > 0 ? Timestamp.fromMillis(millis) : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function isBillableConversationData(data = {}) {
  return Boolean(
    text(data.billingConversationSourceId)
    || data.createdAt
    || data.optInConfirmationSentAt
    || data.lastMessageAt
    || text(data.lastMessage)
  );
}

export function addBillingConversationEventToBatch(batch, db, options) {
  const ref = billingConversationEventRef(db, options);
  batch.set(ref, billingConversationEventData(options), { merge: false });
  return ref;
}

async function backfillConversationEvents({ db, clientId }) {
  const root = db.collection("ocmClients").doc(clientId);
  const [conversations, recorded] = await Promise.all([
    root.collection("leadConversations").get(),
    root.collection("billingConversationEvents").get(),
  ]);
  const recordedIds = new Set(recorded.docs.map((document) => document.id));
  let batch = db.batch();
  let writes = 0;
  for (const document of conversations.docs) {
    const data = document.data();
    if (!isBillableConversationData(data)) continue;
    const occurredAt = billingTimestampMillis(data.createdAt || data.optInConfirmationSentAt || data.lastMessageAt);
    if (!occurredAt) continue;
    const sourceId = text(data.billingConversationSourceId) || `legacy:${document.id}`;
    const eventId = billingConversationEventId(clientId, sourceId);
    if (recordedIds.has(eventId)) continue;
    batch.set(
      root.collection("billingConversationEvents").doc(eventId),
      billingConversationEventData({
        conversationId: document.id,
        sourceId,
        occurredAt,
        sourceType: "legacy-backfill",
      }),
      { merge: false }
    );
    writes += 1;
    if (writes % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (writes % 400 !== 0) await batch.commit();
}

export async function loadBillingConversationUsage({ db, clientId, startMs, endMs }) {
  await backfillConversationEvents({ db, clientId });
  const snapshot = await db.collection("ocmClients").doc(clientId)
    .collection("billingConversationEvents").get();
  const conversations = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    const occurredAt = billingTimestampMillis(data.occurredAt || data.createdAt);
    if (!occurredAt || occurredAt < startMs || occurredAt >= endMs) continue;
    conversations.push({
      id: document.id,
      conversationId: text(data.conversationId) || document.id,
      occurredAt,
    });
  }
  return {
    count: conversations.length,
    conversations: conversations.sort((left, right) => left.occurredAt - right.occurredAt),
  };
}
