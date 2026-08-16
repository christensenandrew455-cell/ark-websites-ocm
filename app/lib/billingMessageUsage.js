import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

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
    usageRecorded: false,
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
