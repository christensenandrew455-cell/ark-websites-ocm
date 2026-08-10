import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { messageBundleCount } from "./billingPricing.js";

function text(value) { return String(value || "").trim(); }

export function billingTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function billingMessageEventId(clientId, direction, sourceId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(direction).toLowerCase()}:${text(sourceId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function billingMessageEventRef(db, { clientId, direction, sourceId }) {
  return db.collection("ocmClients").doc(clientId).collection("billingMessageEvents")
    .doc(billingMessageEventId(clientId, direction, sourceId));
}

export function billingMessageEventData({ direction, smsParts, occurredAt, sourceType = "message" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    direction: text(direction).toLowerCase() === "inbound" ? "inbound" : "outbound",
    smsParts: Math.max(0, Math.floor(Number(smsParts) || 0)),
    sourceType: text(sourceType) || "message",
    occurredAt: millis > 0 ? Timestamp.fromMillis(millis) : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function addBillingMessageEventToBatch(batch, db, options) {
  const ref = billingMessageEventRef(db, options);
  batch.set(ref, billingMessageEventData(options), { merge: false });
  return ref;
}

export function addBillingMessageEventToTransaction(transaction, db, options) {
  const ref = billingMessageEventRef(db, options);
  transaction.set(ref, billingMessageEventData(options), { merge: false });
  return ref;
}

function isLegacyBillableMessage(data) {
  const direction = text(data.direction).toLowerCase();
  const status = text(data.deliveryStatus).toLowerCase();
  if (direction === "inbound") return status === "received";
  if (direction !== "outbound" || !text(data.providerMessageId)) return false;
  return !["provider-error", "provider-not-configured"].includes(status);
}

async function backfillCurrentMessageEvents({ db, clientId, startMs, endMs }) {
  const root = db.collection("ocmClients").doc(clientId);
  const conversations = await root.collection("leadConversations").get();
  let batch = db.batch();
  let writes = 0;
  for (const conversation of conversations.docs) {
    const messages = await conversation.ref.collection("messages").get();
    for (const document of messages.docs) {
      const data = document.data();
      const occurredAt = billingTimestampMillis(data.createdAt || data.updatedAt);
      if (!occurredAt || occurredAt < startMs || occurredAt >= endMs || !isLegacyBillableMessage(data)) continue;
      const direction = text(data.direction).toLowerCase();
      const sourceId = text(data.providerMessageId) || `${conversation.id}:${document.id}`;
      addBillingMessageEventToBatch(batch, db, {
        clientId,
        direction,
        sourceId,
        sourceType: "legacy-backfill",
        smsParts: data.smsParts,
        occurredAt,
      });
      writes += 1;
      if (writes % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
  }
  if (writes % 400 !== 0) await batch.commit();
}

export async function loadBillingMessageUsage({ db, clientId, startMs, endMs }) {
  await backfillCurrentMessageEvents({ db, clientId, startMs, endMs });
  const snapshot = await db.collection("ocmClients").doc(clientId)
    .collection("billingMessageEvents").get();
  let parts = 0;
  let messages = 0;
  for (const document of snapshot.docs) {
    const data = document.data();
    const occurredAt = billingTimestampMillis(data.occurredAt || data.createdAt);
    if (!occurredAt || occurredAt < startMs || occurredAt >= endMs) continue;
    parts += Math.max(0, Math.floor(Number(data.smsParts) || 0));
    messages += 1;
  }
  return { parts, messages, bundles: messageBundleCount(parts) };
}
