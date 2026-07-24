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

function rawLead(document, collectionKey) {
  const data = document.data();
  return {
    id: document.id,
    collectionKey,
    name: text(data.Name || data.name || data.fullName),
    phone: text(data.Phone || data.phone || data.phoneNumber),
    email: text(data.Email || data.email),
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
    email: visibility.email ? lead.email : "",
    address: visibility.address ? lead.address : "",
    job: visibility.job ? lead.job : "Assigned work",
    requestedDate: visibility.requestedTime ? lead.requestedDate : "",
    requestedTime: visibility.requestedTime ? lead.requestedTime : "",
    notes: visibility.notes ? lead.notes : "",
    updatedAt: lead.updatedAt,
  };
}

export async function GET(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  if (decoded.role !== "employee" || !decoded.clientId) {
    return NextResponse.json({ error: "An employee account is required." }, { status: 403 });
  }

  try {
    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(decoded.uid);
    const businessRef = db.collection("businesses").doc(text(decoded.clientId));
    const [accountSnapshot, businessSnapshot] = await Promise.all([accountRef.get(), businessRef.get()]);
    if (!accountSnapshot.exists || !businessSnapshot.exists) {
      return NextResponse.json({ error: "The employee business account could not be found." }, { status: 404 });
    }
    const account = accountSnapshot.data();
    if (account.accountType !== ACCOUNT_TYPES.BUSINESS_EMPLOYEE || account.status !== "active") {
      return NextResponse.json({ error: "The business owner has not approved this employee account." }, { status: 403 });
    }

    const visibility = normalizeEmployeeVisibility(businessSnapshot.data().employeeVisibility);
    const root = db.collection("ocmClients").doc(text(decoded.clientId));
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

    return NextResponse.json({
      businessName: text(account.businessName || businessSnapshot.data().businessName),
      employeeName: text(account.employeeName),
      visibility,
      leads,
      leadCount: leads.length,
      conversationCount: conversationsSnapshot.size,
    });
  } catch (error) {
    console.error("Unable to load employee dashboard", error);
    return NextResponse.json({ error: "Could not load assigned employee work." }, { status: 500 });
  }
}
