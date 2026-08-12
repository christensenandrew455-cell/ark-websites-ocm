import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { normalizeEmployeeDirectoryVisibility, normalizeEmployeeVisibility } from "../../../lib/accountTypes";
import { addEmployeeActivationToBatch } from "../../../lib/billingEmployeeUsage";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";
import { PER_EMPLOYEE_CENTS } from "../../../lib/stripeUsageBilling";
import { accountPhoneRegistryId } from "../../../lib/signupAvailability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
function conversationId(clientId, collectionKey, leadId) { return createHash("sha256").update(`${clientId}:${collectionKey}:${leadId}`).digest("hex").slice(0, 48); }

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  if (decoded.role !== "customer" || !decoded.clientId) return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  const db = getAdminDb();
  const [accountSnapshot, businessSnapshot] = await Promise.all([db.collection("accounts").doc(decoded.uid).get(), db.collection("businesses").doc(text(decoded.clientId)).get()]);
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  if (account.status !== "active" || business.employeesEnabled !== true) return { response: NextResponse.json({ error: "Turn on Employees in Settings to use this workspace." }, { status: 403 }) };
  return { db, decoded, account, business, clientId: text(decoded.clientId) };
}

function leadPayload(document, collectionKey) {
  const data = document.data();
  return { id: document.id, collectionKey, name: text(data.Name || data.name || data.fullName), job: text(data.Job || data.job || data.service || data.projectType), address: text(data.Address || data.address), requestedDate: text(data.EstimateDate || data.PreferredDate || data.RequestedWeekday), requestedTime: text(data.EstimateTime || data.PreferredTime), assignedEmployeeUid: text(data.assignedEmployeeUid), assignedEmployeeName: text(data.assignedEmployeeName), createdAt: iso(data.createdAt || data.acceptedAt || data.updatedAt) };
}

async function loadWorkspace(db, clientId) {
  const businessRef = db.collection("businesses").doc(clientId);
  const root = db.collection("ocmClients").doc(clientId);
  const [businessSnapshot, employeesSnapshot, contactedSnapshot, clientsSnapshot] = await Promise.all([businessRef.get(), businessRef.collection("employees").get(), root.collection("contactedMe").get(), root.collection("clients").get()]);
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  const employees = employeesSnapshot.docs.map((document) => {
    const data = document.data();
    return { uid: document.id, name: text(data.employeeName), email: text(data.accountEmail), phone: text(data.accountPhone), status: text(data.status || "pending_owner_approval"), createdAt: iso(data.createdAt), approvedAt: iso(data.approvedAt) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return {
    employees,
    activeEmployeeCount: employees.filter((employee) => employee.status === "active").length,
    perEmployeeCents: PER_EMPLOYEE_CENTS,
    messagesEnabled: business.messagesEnabled === true,
    employeeMessagingEnabled: business.employeeMessagingEnabled === true && business.messagesEnabled === true,
    employeeVisibility: normalizeEmployeeVisibility(business.employeeVisibility),
    employeeDirectoryVisibility: normalizeEmployeeDirectoryVisibility(business.employeeDirectoryVisibility),
    leads: [...contactedSnapshot.docs.map((document) => leadPayload(document, "contactedMe")), ...clientsSnapshot.docs.map((document) => leadPayload(document, "clients"))].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

async function refreshEmployeeClaims(auth, employeeDocs, update) {
  await Promise.all(employeeDocs.map(async (employee) => {
    try {
      const record = await auth.getUser(employee.id);
      await auth.setCustomUserClaims(employee.id, { ...(record.customClaims || {}), ...update });
    } catch (error) {
      console.warn("Unable to refresh employee access claims", employee.id, error);
    }
  }));
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try { return NextResponse.json(await loadWorkspace(access.db, access.clientId)); }
  catch (error) { console.error("Unable to load employees", error); return NextResponse.json({ error: "Could not load employees and assignments." }, { status: 500 }); }
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const action = text(body.action).toLowerCase();
    const businessRef = access.db.collection("businesses").doc(access.clientId);
    const root = access.db.collection("ocmClients").doc(access.clientId);

    if (action === "access" || action === "visibility") {
      const visibility = normalizeEmployeeVisibility(body.visibility);
      const directoryVisibility = normalizeEmployeeDirectoryVisibility(body.directoryVisibility);
      const employeeMessagingEnabled = body.employeeMessagingEnabled === true && access.business.messagesEnabled === true;
      const update = { employeeVisibility: visibility, employeeDirectoryVisibility: directoryVisibility, employeeMessagingEnabled, updatedAt: FieldValue.serverTimestamp() };
      const employeesSnapshot = await businessRef.collection("employees").get();
      const batch = access.db.batch();
      batch.set(businessRef, update, { merge: true });
      batch.set(access.db.collection("accounts").doc(access.decoded.uid), update, { merge: true });
      for (const employee of employeesSnapshot.docs) {
        batch.set(employee.ref, { employeeMessagingEnabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        batch.set(access.db.collection("accounts").doc(employee.id), { employeeMessagingEnabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      await batch.commit();
      await refreshEmployeeClaims(getAdminAuth(), employeesSnapshot.docs, { employeeMessagingEnabled });
      return NextResponse.json({ ok: true, visibility, directoryVisibility, employeeMessagingEnabled });
    }

    if (["approve", "activate", "disable"].includes(action)) {
      const employeeUid = text(body.employeeUid);
      if (!employeeUid) return NextResponse.json({ error: "Choose an employee account." }, { status: 400 });
      const employeeRef = businessRef.collection("employees").doc(employeeUid);
      const accountRef = access.db.collection("accounts").doc(employeeUid);
      const employeeSnapshot = await employeeRef.get();
      if (!employeeSnapshot.exists) return NextResponse.json({ error: "That employee account could not be found." }, { status: 404 });
      const nextStatus = action === "disable" ? "disabled" : "active";
      const update = { status: nextStatus, employeeStatus: nextStatus === "active" ? "active" : "disabled", messagesEnabled: access.business.messagesEnabled === true, employeesEnabled: true, employeeMessagingEnabled: access.business.messagesEnabled === true && access.business.employeeMessagingEnabled === true, updatedBy: access.decoded.uid, updatedAt: FieldValue.serverTimestamp(), ...(nextStatus === "active" ? { approvedAt: FieldValue.serverTimestamp(), approvedBy: access.decoded.uid } : { disabledAt: FieldValue.serverTimestamp(), disabledBy: access.decoded.uid }) };
      const batch = access.db.batch();
      batch.set(employeeRef, update, { merge: true });
      batch.set(accountRef, update, { merge: true });
      if (nextStatus === "active" && text(employeeSnapshot.data().status) !== "active") {
        const activatedAt = Date.now();
        addEmployeeActivationToBatch(batch, access.db, {
          clientId: access.clientId,
          employeeUid,
          sourceId: `owner-activation:${activatedAt}`,
          sourceType: action === "approve" ? "owner-approval" : "owner-activation",
          occurredAt: activatedAt,
        });
      } else if (nextStatus === "disabled" && text(employeeSnapshot.data().status) === "active") {
        const disabledAt = Date.now();
        addEmployeeActivationToBatch(batch, access.db, {
          clientId: access.clientId,
          employeeUid,
          sourceId: `active-period-exit:${disabledAt}`,
          sourceType: "active-period-exit",
          occurredAt: disabledAt,
        });
      }
      const nameKey = text(employeeSnapshot.data().employeeNameKey);
      if (nameKey) batch.set(businessRef.collection("employeeHandles").doc(nameKey), { status: update.employeeStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await batch.commit();
      try {
        const auth = getAdminAuth();
        const record = await auth.getUser(employeeUid);
        await auth.setCustomUserClaims(employeeUid, { ...(record.customClaims || {}), messagesEnabled: update.messagesEnabled, employeesEnabled: true, employeeMessagingEnabled: update.employeeMessagingEnabled, accountStatus: nextStatus });
      } catch (error) {
        console.warn("Unable to refresh employee status claims", employeeUid, error);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const employeeUid = text(body.employeeUid);
      if (!employeeUid) return NextResponse.json({ error: "Choose an employee account." }, { status: 400 });
      const employeeRef = businessRef.collection("employees").doc(employeeUid);
      const employeeSnapshot = await employeeRef.get();
      if (!employeeSnapshot.exists) return NextResponse.json({ error: "That employee account could not be found." }, { status: 404 });
      const [contactedSnapshot, clientsSnapshot, conversationsSnapshot] = await Promise.all([
        root.collection("contactedMe").where("assignedEmployeeUid", "==", employeeUid).get(),
        root.collection("clients").where("assignedEmployeeUid", "==", employeeUid).get(),
        root.collection("leadConversations").where("assignedEmployeeUid", "==", employeeUid).get(),
      ]);
      const batch = access.db.batch();
      const unassigned = { assignedEmployeeUid: null, assignedEmployeeName: null, assignedAt: null, updatedAt: FieldValue.serverTimestamp() };
      contactedSnapshot.docs.forEach((document) => batch.set(document.ref, unassigned, { merge: true }));
      clientsSnapshot.docs.forEach((document) => batch.set(document.ref, unassigned, { merge: true }));
      conversationsSnapshot.docs.forEach((document) => batch.set(document.ref, unassigned, { merge: true }));
      if (text(employeeSnapshot.data().status) === "active") {
        const deletedAt = Date.now();
        addEmployeeActivationToBatch(batch, access.db, {
          clientId: access.clientId,
          employeeUid,
          sourceId: `active-employee-deleted:${deletedAt}`,
          sourceType: "active-employee-deleted",
          occurredAt: deletedAt,
        });
      }
      batch.delete(employeeRef);
      batch.delete(access.db.collection("accounts").doc(employeeUid));
      const nameKey = text(employeeSnapshot.data().employeeNameKey);
      if (nameKey) batch.delete(businessRef.collection("employeeHandles").doc(nameKey));
      const phoneRegistryId = accountPhoneRegistryId(employeeSnapshot.data().accountPhoneNormalized || employeeSnapshot.data().accountPhone);
      if (phoneRegistryId) batch.delete(access.db.collection("accountPhoneRegistry").doc(phoneRegistryId));
      await batch.commit();
      await getAdminAuth().deleteUser(employeeUid).catch((error) => console.warn("Unable to delete employee authentication account", employeeUid, error));
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
        if (!employeeSnapshot.exists || employeeSnapshot.data().status !== "active") return NextResponse.json({ error: "Choose an active employee." }, { status: 409 });
        employeeName = text(employeeSnapshot.data().employeeName);
      }
      const recordRef = root.collection(collectionKey).doc(recordId);
      if (!(await recordRef.get()).exists) return NextResponse.json({ error: "That lead or client no longer exists." }, { status: 404 });
      const assignment = { assignedEmployeeUid: employeeUid || null, assignedEmployeeName: employeeName || null, assignedAt: employeeUid ? FieldValue.serverTimestamp() : null, assignedBy: access.decoded.uid, updatedAt: FieldValue.serverTimestamp() };
      const batch = access.db.batch();
      batch.set(recordRef, assignment, { merge: true });
      batch.set(root.collection("leadConversations").doc(conversationId(access.clientId, collectionKey, recordId)), assignment, { merge: true });
      await batch.commit();
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unsupported employee action." }, { status: 400 });
  } catch (error) {
    console.error("Unable to update employee workspace", error);
    return NextResponse.json({ error: "Could not update the employee workspace." }, { status: 500 });
  }
}
