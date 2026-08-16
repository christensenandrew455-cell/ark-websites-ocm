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
  return db.collection("accounts").doc(clientId).collection("billingConversationEvents")
    .doc(billingConversationEventId(clientId, sourceId));
}

export function billingConversationEventData({ conversationId, sourceId, occurredAt, sourceType = "chat-created" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    conversationId: text(conversationId),
    sourceIdHash: createHash("sha256").update(text(sourceId)).digest("hex"),
    sourceType: text(sourceType) || "chat-created",
    usageRecorded: false,
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
