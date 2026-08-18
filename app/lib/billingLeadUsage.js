import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { billingTimestampMillis } from "./billingMessageUsage.js";

function text(value) { return String(value || "").trim(); }

export const ACCEPTED_LEAD_BILLING_SOURCE = "accepted-lead";

export function acceptedLeadBillingSourceId(leadId) {
  return `accepted:${text(leadId)}`;
}

export function billingLeadEventId(clientId, sourceId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(sourceId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function billingLeadEventRef(db, { clientId, sourceId }) {
  return db.collection("accounts").doc(clientId).collection("billingLeadEvents")
    .doc(billingLeadEventId(clientId, sourceId));
}

export function billingLeadEventData({ leadId, jobId = "", occurredAt, sourceType = "unclassified" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    leadId: text(leadId),
    jobId: text(jobId) || null,
    sourceType: text(sourceType) || "unclassified",
    usageRecorded: false,
    occurredAt: millis > 0 ? Timestamp.fromMillis(millis) : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function addBillingLeadEventToBatch(batch, db, options) {
  const ref = billingLeadEventRef(db, options);
  batch.create(ref, billingLeadEventData(options));
  return ref;
}
