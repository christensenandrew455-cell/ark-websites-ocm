import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, DEFAULT_EMPLOYEE_VISIBILITY } from "../../../lib/accountTypes";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { BILLING_VERSION, MONTHLY_BASE_CENTS, PER_CALL_CENTS, PER_EMPLOYEE_CENTS, PER_MESSAGE_CONVERSATION_CENTS } from "../../../lib/stripeUsageBilling";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone(value) {
  const digits = trimmedText(value).replace(/^tel:/i, "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  let createdUser = null;
  let committed = false;
  try {
    const body = await request.json();
    const businessName = trimmedText(body.businessName);
    const ownerName = trimmedText(body.ownerName);
    const accountEmail = trimmedText(body.accountEmail).toLowerCase();
    const temporaryPassword = String(body.temporaryPassword || "");
    const clientId = normalizeClientId(body.clientId || businessName);
    const businessPhone = trimmedText(body.businessPhone);
    const notificationEmail = trimmedText(body.notificationEmail || accountEmail).toLowerCase();
    const notificationPhone = trimmedText(body.notificationPhone || businessPhone);
    const sourceLabel = trimmedText(body.sourceLabel || `${businessName} receptionist`);
    const receptionistPhone = trimmedText(body.receptionistPhone);
    const receptionistPhoneNormalized = normalizePhone(receptionistPhone);

    if (!businessName || !ownerName || !clientId) return NextResponse.json({ error: "Business name, owner name, and client ID are required." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return NextResponse.json({ error: "Enter a valid customer login email." }, { status: 400 });
    if (notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) return NextResponse.json({ error: "Enter a valid lead notification email." }, { status: 400 });
    if (temporaryPassword.length < 8) return NextResponse.json({ error: "The temporary password must be at least 8 characters." }, { status: 400 });

    const db = getAdminDb();
    const auth = getAdminAuth();
    const businessRef = db.collection("businesses").doc(clientId);
    const [businessSnapshot, existingUser, duplicatePhone] = await Promise.all([
      businessRef.get(),
      auth.getUserByEmail(accountEmail).catch(() => null),
      receptionistPhoneNormalized ? db.collection("connections").where("receptionistPhoneNormalized", "==", receptionistPhoneNormalized).limit(1).get() : Promise.resolve({ empty: true }),
    ]);
    if (businessSnapshot.exists) return NextResponse.json({ error: "That client ID is already in use." }, { status: 409 });
    if (existingUser) return NextResponse.json({ error: "That login email already has an account." }, { status: 409 });
    if (!duplicatePhone.empty) return NextResponse.json({ error: "That connection phone number is already assigned to another account." }, { status: 409 });

    createdUser = await auth.createUser({ email: accountEmail, password: temporaryPassword, displayName: ownerName, emailVerified: false });
    const claims = { role: "customer", accountType: ACCOUNT_TYPES.OWNER, businessRole: "owner", clientId, accountStatus: "active", billingPlan: "standard", messagesEnabled: false, employeesEnabled: false, employeeMessagingEnabled: false };
    await auth.setCustomUserClaims(createdUser.uid, claims);

    const connectionKey = randomBytes(24).toString("hex");
    const accountData = {
      uid: createdUser.uid,
      ownerUid: createdUser.uid,
      clientId,
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      businessName,
      businessNameKey: clientId,
      ownerName,
      accountEmail,
      accountPhone: businessPhone,
      status: "active",
      verificationStatus: "not_required",
      businessSetupComplete: false,
      paymentSetupStatus: "admin-created",
      billingPlan: "standard",
      billingPlanName: "ARK AI Receptionist",
      billingVersion: BILLING_VERSION,
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      includedLeads: 0,
      includedConversations: 0,
      includedEmployees: 0,
      perCallCents: PER_CALL_CENTS,
      perMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
      perEmployeeCents: PER_EMPLOYEE_CENTS,
      messagesEnabled: false,
      employeesEnabled: false,
      employeeMessagingEnabled: false,
      employeeVisibility: DEFAULT_EMPLOYEE_VISIBILITY,
      createdBy: admin.decodedToken.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const connectionData = { clientId, businessName, ownerName, enabled: true, businessPhone, notificationPhone, notificationEmail, sourceLabel, defaultStage: "contactedMe", allowStageOverride: false, connectionKey, receptionistPhone, receptionistPhoneNormalized, updatedBy: admin.decodedToken.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };

    const batch = db.batch();
    batch.set(db.collection("accounts").doc(createdUser.uid), accountData);
    batch.set(businessRef, accountData);
    batch.set(db.collection("businessNameRegistry").doc(clientId), { clientId, businessName, ownerUid: createdUser.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    batch.set(db.collection("connections").doc(clientId), connectionData);
    batch.set(db.collection("ocmClients").doc(clientId), { businessName, ownerUid: createdUser.uid, status: "active", businessSetupComplete: false, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", billingPlanName: "ARK AI Receptionist", billingVersion: BILLING_VERSION, monthlyBaseCents: MONTHLY_BASE_CENTS, perCallCents: PER_CALL_CENTS, perMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS, perEmployeeCents: PER_EMPLOYEE_CENTS, messagesEnabled: false, employeesEnabled: false, employeeMessagingEnabled: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), { BusinessName: businessName, OwnerName: ownerName, AccountEmail: accountEmail, AccountPhone: businessPhone, NotificationEmail: notificationEmail, NotificationPhone: notificationPhone, BillingStatus: "Admin created", AccountType: ACCOUNT_TYPES.OWNER, BillingPlan: "standard", BillingPlanName: "ARK AI Receptionist", BillingVersion: BILLING_VERSION, MonthlyBaseCents: MONTHLY_BASE_CENTS, PerCallCents: PER_CALL_CENTS, PerMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS, PerEmployeeCents: PER_EMPLOYEE_CENTS, MessagesEnabled: false, EmployeesEnabled: false, EmployeeMessagingEnabled: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const adminClientId = trimmedText(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
    if (adminClientId && adminClientId !== clientId) {
      batch.set(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId), { Name: ownerName, BusinessName: businessName, Phone: businessPhone, Email: accountEmail, Address: businessName, PropertyKey: `business-${clientId}`, Job: "ARK AI Receptionist account", BestContactMethod: businessPhone ? "Call" : "Email", Notes: `ARK AI Receptionist account for ${businessName}.`, source: "admin-onboarding", RelatedBusinessClientId: clientId, AccountStatus: "active", BillingPlan: "standard", BillingPlanName: "ARK AI Receptionist", currentStage: "clients", TotalJobs: 1, RepeatJobs: 0, createdAt: FieldValue.serverTimestamp(), movedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    await batch.commit();
    committed = true;
    return NextResponse.json({ ok: true, clientId, businessName, accountEmail, connectionKey, receptionistPhone }, { status: 201 });
  } catch (error) {
    console.error("Unable to create customer account", error);
    if (createdUser?.uid && !committed) await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    return NextResponse.json({ error: "Could not create the customer account. Check the server logs for details." }, { status: 500 });
  }
}
