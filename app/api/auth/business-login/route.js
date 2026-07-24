import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, normalizePersonKey } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";
import { normalizeClientId } from "../../../lib/valueUtils";

const OWNER_STATUSES = new Set(["approved_pending_payment", "active", "disabled"]);
const EMPLOYEE_STATUSES = new Set(["pending_owner_approval", "active", "disabled"]);

async function resolveBusiness(db, identifier) {
  const requestedKey = normalizeClientId(identifier);
  if (!requestedKey) return null;
  const registrySnapshot = await db.collection("businessNameRegistry").doc(requestedKey).get();
  const clientId = normalizeClientId(registrySnapshot.exists ? registrySnapshot.data().clientId : requestedKey);
  const snapshot = await db.collection("businesses").doc(clientId).get();
  return snapshot.exists ? { clientId, data: snapshot.data() } : null;
}

export async function POST(request) {
  try {
    const { identifier, personName, password, loginMode } = await request.json();
    const normalizedIdentifier = String(identifier || "").trim();
    const mode = String(loginMode || "owner").trim().toLowerCase() === "employee" ? "employee" : "owner";
    if (!normalizedIdentifier || !password) return NextResponse.json({ error: "Enter the required sign-in information." }, { status: 400 });

    const db = getAdminDb();
    let email = normalizedIdentifier.toLowerCase();

    if (!email.includes("@")) {
      const resolvedBusiness = await resolveBusiness(db, normalizedIdentifier);
      if (!resolvedBusiness || !OWNER_STATUSES.has(String(resolvedBusiness.data.status || ""))) return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });

      if (mode === "employee") {
        const personKey = normalizePersonKey(personName);
        if (!personKey) return NextResponse.json({ error: "Enter your name for employee sign in." }, { status: 400 });
        const handleSnapshot = await db.collection("businesses").doc(resolvedBusiness.clientId).collection("employeeHandles").doc(personKey).get();
        if (!handleSnapshot.exists) return NextResponse.json({ error: "Business, employee name, or password is incorrect." }, { status: 401 });
        email = String(handleSnapshot.data().email || "").toLowerCase();
      } else {
        email = String(resolvedBusiness.data.accountEmail || "").toLowerCase();
      }
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Firebase Authentication is not configured." }, { status: 500 });
    const passwordResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      cache: "no-store",
    });
    const passwordResult = await passwordResponse.json();
    if (!passwordResponse.ok || !passwordResult.localId) return NextResponse.json({ error: mode === "employee" ? "Business, employee name, or password is incorrect." : "Business name or password is incorrect." }, { status: 401 });

    const auth = getAdminAuth();
    const userRecord = await auth.getUser(passwordResult.localId);
    const accountSnapshot = await db.collection("accounts").doc(userRecord.uid).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const isAdmin = getAdminEmails().has(email.toLowerCase()) || account.role === "admin";
    const isEmployee = account.role === "employee" || account.accountType === ACCOUNT_TYPES.EMPLOYEE;

    if (!isAdmin && !accountSnapshot.exists) return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    if (!isAdmin && isEmployee && !EMPLOYEE_STATUSES.has(String(account.status || ""))) return NextResponse.json({ error: "This employee account is not available." }, { status: 403 });
    if (!isAdmin && !isEmployee && (!OWNER_STATUSES.has(String(account.status || "")) || !account.clientId)) return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    if (!isAdmin && account.status === "disabled") return NextResponse.json({ error: "This account is disabled." }, { status: 403 });
    if (!isAdmin && mode === "employee" && !isEmployee) return NextResponse.json({ error: "Use Owner Sign In for this account." }, { status: 409 });
    if (!isAdmin && mode === "owner" && isEmployee) return NextResponse.json({ error: "Use Employee Sign In for this account." }, { status: 409 });

    const claims = isAdmin
      ? { role: "admin", accountStatus: "active", ...(account.clientId ? { clientId: account.clientId } : {}) }
      : isEmployee
        ? {
            role: "employee",
            accountType: ACCOUNT_TYPES.EMPLOYEE,
            businessRole: "employee",
            businessClientId: account.clientId,
            accountStatus: account.status,
            billingPlan: "standard",
            messagesEnabled: account.messagesEnabled === true,
            employeeMessagingEnabled: account.employeeMessagingEnabled === true,
            termsAccepted: account.termsAccepted === true,
            privacyAccepted: account.privacyAccepted === true,
            termsVersion: String(account.termsVersion || ""),
            privacyVersion: String(account.privacyVersion || ""),
          }
        : {
            role: "customer",
            accountType: ACCOUNT_TYPES.OWNER,
            businessRole: "owner",
            clientId: account.clientId,
            accountStatus: account.status,
            billingPlan: "standard",
            messagesEnabled: account.messagesEnabled === true,
            employeesEnabled: account.employeesEnabled === true,
            employeeMessagingEnabled: account.employeeMessagingEnabled === true,
            termsAccepted: account.termsAccepted === true,
            privacyAccepted: account.privacyAccepted === true,
            termsVersion: String(account.termsVersion || ""),
            privacyVersion: String(account.privacyVersion || ""),
          };

    await auth.setCustomUserClaims(userRecord.uid, claims);
    if (isAdmin) {
      await db.collection("accounts").doc(userRecord.uid).set({ uid: userRecord.uid, accountEmail: email, ownerName: account.ownerName || userRecord.displayName || "ARK OCM Admin", businessName: account.businessName || "ARK Websites", clientId: account.clientId || "", role: "admin", status: "active", updatedAt: new Date() }, { merge: true });
    }
    const token = await auth.createCustomToken(userRecord.uid, claims);
    return NextResponse.json({ token, role: isAdmin ? "admin" : isEmployee ? "employee" : "customer", accountType: claims.accountType || "admin", status: isAdmin ? "active" : account.status });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
