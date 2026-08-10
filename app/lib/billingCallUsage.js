import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { billingTimestampMillis } from "./billingMessageUsage.js";

function text(value) { return String(value || "").trim(); }

export function billingCallEventId(clientId, callId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(callId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function billingCallEventRef(db, { clientId, callId }) {
  return db.collection("ocmClients").doc(clientId).collection("billingCallEvents")
    .doc(billingCallEventId(clientId, callId));
}

export function billingCallEventData({ callId, occurredAt, sourceType = "receptionist-call" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    callId: text(callId),
    sourceType: text(sourceType) || "receptionist-call",
    occurredAt: millis > 0 ? Timestamp.fromMillis(millis) : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function addBillingCallEventToTransaction(transaction, db, options) {
  const ref = billingCallEventRef(db, options);
  transaction.set(ref, billingCallEventData(options), { merge: true });
  return ref;
}

async function backfillCallEvents({ db, clientId }) {
  const root = db.collection("ocmClients").doc(clientId);
  const [calls, recorded] = await Promise.all([
    root.collection("receptionistCalls").get(),
    root.collection("billingCallEvents").get(),
  ]);
  const recordedIds = new Set(recorded.docs.map((document) => document.id));
  let batch = db.batch();
  let writes = 0;
  for (const document of calls.docs) {
    const data = document.data();
    const occurredAt = billingTimestampMillis(data.startedAt || data.endedAt || data.createdAt);
    if (!occurredAt) continue;
    const eventId = billingCallEventId(clientId, document.id);
    if (recordedIds.has(eventId)) continue;
    batch.set(
      root.collection("billingCallEvents").doc(eventId),
      billingCallEventData({ callId: document.id, occurredAt, sourceType: "legacy-backfill" }),
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

export async function loadBillingCalls({ db, clientId, startMs, endMs }) {
  await backfillCallEvents({ db, clientId });
  const snapshot = await db.collection("ocmClients").doc(clientId)
    .collection("billingCallEvents").get();
  const calls = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    const occurredAt = billingTimestampMillis(data.occurredAt || data.createdAt);
    if (!occurredAt || occurredAt < startMs || occurredAt >= endMs) continue;
    const callId = text(data.callId) || document.id;
    calls.push({ id: callId, eventId: document.id, callId, occurredAt });
  }
  return calls.sort((left, right) => left.occurredAt - right.occurredAt);
}
