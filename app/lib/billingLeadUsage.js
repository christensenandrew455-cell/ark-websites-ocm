import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { billingTimestampMillis } from "./billingMessageUsage.js";
import { normalizeJobs } from "./propertyProfiles.js";

function text(value) { return String(value || "").trim(); }

export function billingLeadEventId(clientId, sourceId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(sourceId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function billingLeadEventRef(db, { clientId, sourceId }) {
  return db.collection("ocmClients").doc(clientId).collection("billingLeadEvents")
    .doc(billingLeadEventId(clientId, sourceId));
}

export function billingLeadEventData({ leadId, jobId = "", occurredAt, sourceType = "intake" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    leadId: text(leadId),
    jobId: text(jobId) || null,
    sourceType: text(sourceType) || "intake",
    occurredAt: millis > 0 ? Timestamp.fromMillis(millis) : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function addBillingLeadEventToBatch(batch, db, options) {
  const ref = billingLeadEventRef(db, options);
  batch.create(ref, billingLeadEventData(options));
  return ref;
}

function eligibleLeadDocuments(contactedSnapshot, clientsSnapshot) {
  return [
    ...contactedSnapshot.docs.map((document) => ({ document, stageKey: "contactedMe" })),
    ...clientsSnapshot.docs
      .filter((document) => {
        const data = document.data();
        return text(data.previousStage) === "contactedMe"
          || text(data.reviewStatus) === "accepted";
      })
      .map((document) => ({ document, stageKey: "clients" })),
  ];
}

async function backfillLeadEvents({ db, clientId }) {
  const root = db.collection("ocmClients").doc(clientId);
  const [contactedSnapshot, clientsSnapshot, recordedSnapshot] = await Promise.all([
    root.collection("contactedMe").get(),
    root.collection("clients").get(),
    root.collection("billingLeadEvents").get(),
  ]);
  const recordedJobs = new Set(recordedSnapshot.docs.map((document) => {
    const data = document.data();
    return data.jobId ? `${text(data.leadId)}:${text(data.jobId)}` : "";
  }).filter(Boolean));
  const recordedLeadsWithoutJobs = new Set(recordedSnapshot.docs.map((document) => {
    const data = document.data();
    return data.jobId ? "" : text(data.leadId);
  }).filter(Boolean));

  let batch = db.batch();
  let writes = 0;
  for (const { document, stageKey } of eligibleLeadDocuments(contactedSnapshot, clientsSnapshot)) {
    const data = document.data();
    const jobs = normalizeJobs(data, stageKey);
    const candidates = jobs.length ? jobs : [{ id: "record", createdAt: data.createdAt }];
    for (const job of candidates) {
      const jobId = text(job.id) || "record";
      const occurredAt = billingTimestampMillis(job.createdAt || data.createdAt);
      if (!occurredAt) continue;
      if (recordedJobs.has(`${document.id}:${jobId}`)) continue;
      if (recordedLeadsWithoutJobs.has(document.id) && jobId === "record") continue;
      const sourceId = `legacy:${document.id}:${jobId}`;
      batch.set(
        root.collection("billingLeadEvents").doc(billingLeadEventId(clientId, sourceId)),
        billingLeadEventData({
          leadId: document.id,
          jobId,
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
  }
  if (writes % 400 !== 0) await batch.commit();
}

export async function loadBillingLeads({ db, clientId, startMs, endMs }) {
  await backfillLeadEvents({ db, clientId });
  const snapshot = await db.collection("ocmClients").doc(clientId)
    .collection("billingLeadEvents").get();
  const leads = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    const occurredAt = billingTimestampMillis(data.occurredAt || data.createdAt);
    if (!occurredAt || occurredAt < startMs || occurredAt >= endMs) continue;
    leads.push({
      id: document.id,
      eventId: document.id,
      leadId: text(data.leadId) || document.id,
      occurredAt,
    });
  }
  return leads.sort((left, right) => left.occurredAt - right.occurredAt);
}
