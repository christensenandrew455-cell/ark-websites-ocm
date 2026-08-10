import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { billingTimestampMillis } from "./billingMessageUsage.js";

function text(value) { return String(value || "").trim(); }

export function billingEmployeeActivationId(clientId, employeeUid, sourceId) {
  return createHash("sha256")
    .update(`${text(clientId)}:${text(employeeUid)}:${text(sourceId)}`)
    .digest("hex")
    .slice(0, 48);
}

export function billingEmployeeActivationRef(db, { clientId, employeeUid, sourceId }) {
  return db.collection("ocmClients").doc(clientId).collection("billingEmployeeActivations")
    .doc(billingEmployeeActivationId(clientId, employeeUid, sourceId));
}

export function billingEmployeeActivationData({ employeeUid, sourceType = "owner-activation", occurredAt, billingPeriodKey = "" }) {
  const millis = billingTimestampMillis(occurredAt);
  return {
    employeeUid: text(employeeUid),
    sourceType: text(sourceType) || "owner-activation",
    billingPeriodKey: text(billingPeriodKey) || null,
    occurredAt: millis > 0 ? Timestamp.fromMillis(millis) : FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export function addEmployeeActivationToBatch(batch, db, options) {
  const ref = billingEmployeeActivationRef(db, options);
  batch.set(ref, billingEmployeeActivationData(options), { merge: false });
  return ref;
}

async function ensureActiveEmployeePeriodEntries({ db, clientId, window, activeEmployees }) {
  if (!activeEmployees?.length) return;
  const batch = db.batch();
  for (const employee of activeEmployees) {
    const employeeUid = text(employee.id || employee.uid);
    if (!employeeUid) continue;
    const sourceId = `period:${window.monthKey}:${employeeUid}`;
    batch.set(
      billingEmployeeActivationRef(db, { clientId, employeeUid, sourceId }),
      billingEmployeeActivationData({
        employeeUid,
        sourceType: "active-in-period",
        billingPeriodKey: window.monthKey,
        occurredAt: window.startMs + 1,
      }),
      { merge: true }
    );
  }
  await batch.commit();
}

export async function loadBillingEmployeeUsage({ db, clientId, window, activeEmployees = [] }) {
  await ensureActiveEmployeePeriodEntries({ db, clientId, window, activeEmployees });
  const snapshot = await db.collection("ocmClients").doc(clientId)
    .collection("billingEmployeeActivations").get();
  const uniqueEmployees = new Set();
  for (const document of snapshot.docs) {
    const data = document.data();
    const occurredAt = billingTimestampMillis(data.occurredAt || data.createdAt);
    const employeeUid = text(data.employeeUid);
    if (!employeeUid || !occurredAt || occurredAt < window.startMs || occurredAt >= window.endMs) continue;
    uniqueEmployees.add(employeeUid);
  }
  return { count: uniqueEmployees.size, employeeIds: [...uniqueEmployees].sort() };
}
