import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, normalizeEmployeeDirectoryVisibility, normalizeEmployeeVisibility } from "../../../lib/accountTypes";
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

function rawLead(document, collectionKey) {
  const data = document.data();
  return {
    id: document.id,
    collectionKey,
    name: text(data.Name || data.name || data.fullName),
    phone: text(data.Phone || data.phone || data.phoneNumber),
    address: text(data.Address || data.address),
    job: text(data.Job || data.job || data.service || data.projectType),
    requestedDate: text(data.EstimateDate || data.PreferredDate || data.RequestedWeekday),
    requestedTime: text(data.EstimateTime || data.PreferredTime),
    notes: text(data.Notes || data.notes || data.message),
    assignedEmployeeUid: text(data.assignedEmployeeUid),
    updatedAt: iso(data.updatedAt || data.acceptedAt || data.createdAt),
  };
}

function filteredLead(lead, visibility) {
  return {
    id: lead.id,
    collectionKey: lead.collectionKey,
    name: visibility.name ? lead.name : "Assigned lead",
    phone: visibility.phone ? lead.phone : "",
    address: visibility.address ? lead.address : "",
    job: visibility.job ? lead.job : "Assigned work",
    requestedDate: visibility.requestedTime ? lead.requestedDate : "",
    requestedTime: visibility.requestedTime ? lead.requestedTime : "",
    notes: visibility.notes ? lead.notes : "",
    updatedAt: lead.updatedAt,
  };
}

function employeeDirectory(employees, currentUid, visibility) {
  return employees
    .filter((employee) => text(employee.status) === "active")
    .sort((first, second) => text(first.employeeName).localeCompare(text(second.employeeName)))
    .map((employee, index) => {
      const isCurrent = employee.uid === currentUid;
      return {
        uid: employee.uid,
        isCurrent,
        name: isCurrent || visibility.name ? text(employee.employeeName) || (isCurrent ? "You" : `Employee ${index + 1}`) : `Employee ${index + 1}`,
        email: isCurrent || visibility.email ? text(employee.accountEmail) : "",
        phone: isCurrent || visibility.phone ? text(employee.accountPhone) : "",
      };
    });
}

export async function GET(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  const clientId = text(decoded.businessClientId || decoded.clientId);
  if (decoded.role !== "employee" || !clientId) {
    return NextResponse.json({ error: "An employee account is required." }, { status: 403 });
  }

  try {
    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(decoded.uid);
    const businessRef = db.collection("businesses").doc(clientId);
    const root = db.collection("ocmClients").doc(clientId);
    const [accountSnapshot, businessSnapshot, employeesSnapshot, receptionistSnapshot, accountSettingsSnapshot] = await Promise.all([
      accountRef.get(),
      businessRef.get(),
      businessRef.collection("employees").get(),
      root.collection("settings").doc("receptionist").get(),
      root.collection("settings").doc("account").get(),
    ]);
    if (!accountSnapshot.exists || !businessSnapshot.exists) {
      return NextResponse.json({ error: "The employee business account could not be found." }, { status: 404 });
    }
    const account = accountSnapshot.data();
    const business = businessSnapshot.data();
    if (account.accountType !== ACCOUNT_TYPES.BUSINESS_EMPLOYEE || account.status !== "active" || text(account.clientId) !== clientId) {
      return NextResponse.json({ error: "The business owner has not approved this employee account." }, { status: 403 });
    }

    const receptionist = receptionistSnapshot.exists ? receptionistSnapshot.data() : {};
    const accountSettings = accountSettingsSnapshot.exists ? accountSettingsSnapshot.data() : {};
    const ownerUid = text(business.ownerUid || business.uid);
    const ownerSnapshot = ownerUid ? await db.collection("accounts").doc(ownerUid).get() : null;
    const ownerAccount = ownerSnapshot?.exists ? ownerSnapshot.data() : {};

    const visibility = normalizeEmployeeVisibility(business.employeeVisibility);
    const directoryVisibility = normalizeEmployeeDirectoryVisibility(business.employeeDirectoryVisibility);
    const [contactedSnapshot, clientsSnapshot, conversationsSnapshot] = await Promise.all([
      root.collection("contactedMe").where("assignedEmployeeUid", "==", decoded.uid).get(),
      root.collection("clients").where("assignedEmployeeUid", "==", decoded.uid).get(),
      root.collection("leadConversations").where("assignedEmployeeUid", "==", decoded.uid).get(),
    ]);
    const leads = [
      ...contactedSnapshot.docs.map((document) => rawLead(document, "contactedMe")),
      ...clientsSnapshot.docs.map((document) => rawLead(document, "clients")),
    ]
      .sort((first, second) => String(second.updatedAt).localeCompare(String(first.updatedAt)))
      .map((lead) => filteredLead(lead, visibility));

    const employees = employeesSnapshot.docs.map((document) => ({ uid: document.id, ...document.data() }));
    const employeeMessagingEnabled = business.messagesEnabled === true && business.employeesEnabled === true && business.employeeMessagingEnabled === true;
    const businessEmail = text(receptionist.businessEmail || accountSettings.AccountEmail || business.accountEmail);
    const businessPhone = text(receptionist.businessPhone || accountSettings.AccountPhone || business.accountPhone);

    return NextResponse.json({
      businessName: text(receptionist.businessName || account.businessName || business.businessName),
      ownerName: text(receptionist.ownerName || business.ownerName || ownerAccount.ownerName),
      businessEmail,
      businessPhone,
      ownerEmail: text(ownerAccount.accountEmail || ownerAccount.email || business.ownerEmail || businessEmail),
      ownerPhone: text(ownerAccount.accountPhone || ownerAccount.phone || business.ownerPhone || businessPhone),
      employeeName: text(account.employeeName),
      visibility,
      directoryVisibility,
      employees: employeeDirectory(employees, decoded.uid, directoryVisibility),
      employeeMessagingEnabled,
      leads,
      leadCount: leads.length,
      conversationCount: employeeMessagingEnabled ? conversationsSnapshot.size : 0,
    });
  } catch (error) {
    console.error("Unable to load employee dashboard", error);
    return NextResponse.json({ error: "Could not load assigned employee work." }, { status: 500 });
  }
}
