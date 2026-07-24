import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, normalizeEmployeeVisibility } from "../../../lib/accountTypes";
import { getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function conversationId(clientId, collectionKey, leadId) {
  return createHash("sha256").update(`${clientId}:${collectionKey}:${leadId}`).digest("hex").slice(0, 48);
}

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  if (decoded.role !== "customer" || !decoded.clientId) {
    return { response: NextResponse.json({ error: "A Business owner account is required." }, { status: 403 }) };
  }
  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").doc(decoded.uid).get();
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  if (account.status !== "active" || account.billingPlan !== "business" || account.accountType !== ACCOUNT_TYPES.BUSINESS_OWNER) {
    return { response: NextResponse.json({ error: "A current Business owner account is required." }, { status: 403 }) };
  }
  return { db, decoded, account, clientId: text(decoded.clientId) };
}

function leadPayload(document, collectionKey) {
  const data = document.data();
  return {
    id: document.id,
    collectionKey,
    name: text(data.Name || data.name || data.fullName),
    job: text(data.Job || data.job || data.service || data.projectType),
    address: text(data.Address || data.address),
    requestedDate: text(data.EstimateDate || data.PreferredDate || data.RequestedWeekday),
    requestedTime: text(data.EstimateTime || data.PreferredTime),
    assignedEmployeeUid: text(data.assignedEmployeeUid),
    assignedEmployeeName: text(data.assignedEmployeeName),
    createdAt: iso(data.createdAt || data.acceptedAt || data.updatedAt),
  };
}

async function loadWorkspace(db, clientId) {
  const businessRef = db.collection("businesses").doc(clientId);
  const root = db.collection("ocmClients").doc(clientId);
  const [businessSnapshot, employeesSnapshot, contactedSnapshot, clientsSnapshot] = await Promise.all([
    businessRef.get(),
    businessRef.collection("employees").get(),
    root.collection("contactedMe").get(),
    root.collection("clients").get(),
  ]);
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  const employees = employeesSnapshot.docs.map((document) => {
    const data = document.data();
    return {
      uid: document.id,
      name: text(data.employeeName),
      email: text(data.accountEmail),
      phone: text(data.accountPhone),
      status: text(data.status || "pending_owner_approval"),
      createdAt: iso(data.createdAt),
      approvedAt: iso(data.approvedAt),
    };
  }).sort((first, second) => first.name.localeCompare(second.name));
  return {
    employees,
    activeEmployeeCount: employees.filter((employee) => employee.status === "active").length,
    includedEmployees: Number(business.includedEmployees || 3),
    employeeVisibility: normalizeEmployeeVisibility(business.employeeVisibility),
    leads: [
      ...contactedSnapshot.docs.map((document) => leadPayload(document, "contactedMe")),
      ...clientsSnapshot.docs.map((document) => leadPayload(document, "clients")),
    ].sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt))),
  };
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    return NextResponse.json(await loadWorkspace(access.db, access.clientId));
  } catch (error) {
    console.error("Unable to load Business employees", error);
    return NextResponse.json({ error: "Could not load employees and assignments." }, { status: 500 });
  }
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const action = text(body.action).toLowerCase();
    const businessRef = access.db.collection("businesses").doc(access.clientId);

    if (action === "visibility") {
      const visibility = normalizeEmployeeVisibility(body.visibility);
      await Promise.all([
        businessRef.set({ employeeVisibility: visibility, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
        access.db.collection("accounts").doc(access.decoded.uid).set({ employeeVisibility: visibility, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      ]);
      return NextResponse.json({ ok: true, visibility });
    }

    if (["approve", "activate", "disable"].includes(action)) {
      const employeeUid = text(body.employeeUid);
      if (!employeeUid) return NextResponse.json({ error: "Choose an employee account." }, { status: 400 });
      const employeeRef = businessRef.collection("employees").doc(employeeUid);
      const accountRef = access.db.collection("accounts").doc(employeeUid);
      const employeeSnapshot = await employeeRef.get();
      if (!employeeSnapshot.exists) return NextResponse.json({ error: "That employee account could not be found." }, { status: 404 });
      const nextStatus = action === "disable" ? "disabled" : "active";
      const update = {
        status: nextStatus,
        employeeStatus: nextStatus === "active" ? "active" : "disabled",
        updatedBy: access.decoded.uid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(nextStatus === "active"
          ? { approvedAt: FieldValue.serverTimestamp(), approvedBy: access.decoded.uid }
          : { disabledAt: FieldValue.serverTimestamp(), disabledBy: access.decoded.uid }),
      };
      const batch = access.db.batch();
      batch.set(employeeRef, update, { merge: true });
      batch.set(accountRef, update, { merge: true });
      const nameKey = text(employeeSnapshot.data().employeeNameKey);
      if (nameKey) batch.set(businessRef.collection("employeeHandles").doc(nameKey), { status: update.employeeStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await batch.commit();
      return NextResponse.json({ ok: true });
    }

    if (action === "assign") {
      const collectionKey = body.collectionKey === "clients" ? "clients" : "contactedMe";
      const recordId = text(body.recordId);
      const employeeUid = text(body.employeeUid);
      if (!recordId) return NextResponse.json({ error: "Choose a lead or client." }, { status: 400 });
      let employeeName = "";
      if (employeeUid) {
        const employeeSnapshot = await businessRef.collection("employees").doc(employeeUid).get();
        if (!employeeSnapshot.exists || employeeSnapshot.data().status !== "active") {
          return NextResponse.json({ error: "Choose an active employee." }, { status: 409 });
        }
        employeeName = text(employeeSnapshot.data().employeeName);
      }
      const root = access.db.collection("ocmClients").doc(access.clientId);
      const recordRef = root.collection(collectionKey).doc(recordId);
      if (!(await recordRef.get()).exists) return NextResponse.json({ error: "That lead or client no longer exists." }, { status: 404 });
      const assignment = {
        assignedEmployeeUid: employeeUid || null,
        assignedEmployeeName: employeeName || null,
        assignedAt: employeeUid ? FieldValue.serverTimestamp() : null,
        assignedBy: access.decoded.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      const batch = access.db.batch();
      batch.set(recordRef, assignment, { merge: true });
      batch.set(root.collection("leadConversations").doc(conversationId(access.clientId, collectionKey, recordId)), assignment, { merge: true });
      await batch.commit();
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported employee action." }, { status: 400 });
  } catch (error) {
    console.error("Unable to update Business employees", error);
    return NextResponse.json({ error: "Could not update the Business employee workspace." }, { status: 500 });
  }
}
