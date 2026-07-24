import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, normalizePersonKey } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSignupError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "");
  if (code === "auth/email-already-exists") return "That email address is already registered.";
  return "Unable to create the employee account right now.";
}

export async function POST(request) {
  let createdUser = null;
  try {
    const { businessName, employeeName, accountEmail, accountPhone, password, acceptedTerms, acceptedPrivacy, termsVersion, privacyVersion } = await request.json();
    const requestedBusinessKey = normalizeClientId(businessName);
    const name = trimmedText(employeeName);
    const employeeNameKey = normalizePersonKey(name);
    const email = trimmedText(accountEmail).toLowerCase();
    const phone = trimmedText(accountPhone);
    if (!requestedBusinessKey || !employeeNameKey || !email || !phone || typeof password !== "string") return NextResponse.json({ error: "Complete every employee account field." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Use a password with at least 8 characters." }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (acceptedTerms !== true || acceptedPrivacy !== true) return NextResponse.json({ error: "Agree to the Terms of Use and Privacy Policy before continuing." }, { status: 400 });
    if (termsVersion !== TERMS_VERSION || privacyVersion !== PRIVACY_VERSION) return NextResponse.json({ error: "The legal policies changed. Refresh and review the current versions." }, { status: 409 });

    const auth = getAdminAuth();
    const db = getAdminDb();
    const registrySnapshot = await db.collection("businessNameRegistry").doc(requestedBusinessKey).get();
    const clientId = normalizeClientId(registrySnapshot.exists ? registrySnapshot.data().clientId : requestedBusinessKey);
    const businessRef = db.collection("businesses").doc(clientId);
    const businessSnapshot = await businessRef.get();
    if (!businessSnapshot.exists) return NextResponse.json({ error: "That owner account could not be found." }, { status: 404 });
    const business = businessSnapshot.data();
    if (business.status !== "active" || business.employeesEnabled !== true) return NextResponse.json({ error: "That business is not accepting employee accounts. The owner must enable Employees first." }, { status: 409 });
    if (normalizePersonKey(business.ownerName) === employeeNameKey) return NextResponse.json({ error: "That name is already used by the account owner." }, { status: 409 });
    if (await auth.getUserByEmail(email).catch(() => null)) return NextResponse.json({ error: "That email address is already registered." }, { status: 409 });

    const handleRef = businessRef.collection("employeeHandles").doc(employeeNameKey);
    if ((await handleRef.get()).exists) return NextResponse.json({ error: "An employee with that name already exists under this business." }, { status: 409 });

    createdUser = await auth.createUser({ email, password, displayName: name, emailVerified: false, disabled: false });
    const accountData = {
      uid: createdUser.uid,
      clientId,
      role: "employee",
      accountType: ACCOUNT_TYPES.EMPLOYEE,
      businessRole: "employee",
      businessName: trimmedText(business.businessName || businessName),
      employeeName: name,
      employeeNameKey,
      accountEmail: email,
      accountPhone: phone,
      billingPlan: "standard",
      messagesEnabled: business.messagesEnabled === true,
      employeesEnabled: true,
      employeeMessagingEnabled: business.messagesEnabled === true && business.employeeMessagingEnabled === true,
      status: "pending_owner_approval",
      employeeStatus: "pending",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
      legalAcceptedAt: new Date(),
      legalAcceptedBy: email,
      legalAcceptanceSource: "employee-signup",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (transaction) => {
      const [latestBusiness, latestHandle] = await Promise.all([transaction.get(businessRef), transaction.get(handleRef)]);
      if (!latestBusiness.exists || latestBusiness.data().status !== "active" || latestBusiness.data().employeesEnabled !== true) throw new Error("BUSINESS_UNAVAILABLE");
      if (latestHandle.exists) throw new Error("EMPLOYEE_NAME_TAKEN");
      transaction.create(handleRef, { uid: createdUser.uid, email, employeeName: name, employeeNameKey, status: "pending", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      transaction.create(businessRef.collection("employees").doc(createdUser.uid), accountData);
      transaction.create(db.collection("accounts").doc(createdUser.uid), accountData);
    });

    await auth.setCustomUserClaims(createdUser.uid, {
      role: "employee",
      accountType: ACCOUNT_TYPES.EMPLOYEE,
      businessRole: "employee",
      businessClientId: clientId,
      accountStatus: "pending_owner_approval",
      billingPlan: "standard",
      messagesEnabled: accountData.messagesEnabled,
      employeesEnabled: true,
      employeeMessagingEnabled: accountData.employeeMessagingEnabled,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
    });
    return NextResponse.json({ ok: true, email, clientId, status: "pending_owner_approval" });
  } catch (error) {
    console.error("Unable to create employee account", error);
    if (createdUser?.uid) await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    if (String(error?.message || "") === "EMPLOYEE_NAME_TAKEN") return NextResponse.json({ error: "An employee with that name already exists under this business." }, { status: 409 });
    if (String(error?.message || "") === "BUSINESS_UNAVAILABLE") return NextResponse.json({ error: "That business is not accepting employee accounts." }, { status: 409 });
    return NextResponse.json({ error: safeSignupError(error) }, { status: 500 });
  }
}
