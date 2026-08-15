import { NextResponse } from "next/server";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";
import { MESSAGES_AVAILABLE } from "../../../lib/launchFeatures";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { normalizeClientId } from "../../../lib/valueUtils";

const OWNER_STATUSES = new Set([
  "pending_verification",
  "pending_business_setup",
  "pending_payment",
  "pending_admin_approval",
  "approved_pending_payment",
  "active",
  "disabled",
]);

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
    const { identifier, password } = await request.json();
    const normalizedIdentifier = String(identifier || "").trim();
    if (!normalizedIdentifier || !password) return NextResponse.json({ error: "Enter the required sign-in information." }, { status: 400 });

    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({ db, request, scope: "business-login", limit: 20, windowMs: 10 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    let email = normalizedIdentifier.toLowerCase();
    let resolvedBusiness = null;
    if (!email.includes("@")) {
      resolvedBusiness = await resolveBusiness(db, normalizedIdentifier);
      if (!resolvedBusiness || !OWNER_STATUSES.has(String(resolvedBusiness.data.status || ""))) return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });
      email = String(resolvedBusiness.data.accountEmail || "").toLowerCase();
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
    if (!passwordResponse.ok || !passwordResult.localId) return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });

    const auth = getAdminAuth();
    const userRecord = await auth.getUser(passwordResult.localId);
    const accountSnapshot = await db.collection("accounts").doc(userRecord.uid).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const isAdmin = getAdminEmails().has(email.toLowerCase()) || account.role === "admin";
    let business = resolvedBusiness?.data || null;
    if (!isAdmin && account.clientId && !business) {
      const businessSnapshot = await db.collection("businesses").doc(String(account.clientId)).get();
      business = businessSnapshot.exists ? businessSnapshot.data() : null;
    }

    if (!isAdmin && (!accountSnapshot.exists || account.role !== "customer" || !OWNER_STATUSES.has(String(account.status || "")) || !account.clientId)) {
      return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    }
    if (!isAdmin && account.status === "disabled") return NextResponse.json({ error: "This account is disabled." }, { status: 403 });

    const messagesEnabled = MESSAGES_AVAILABLE && (business?.messagesEnabled === true || account.messagesEnabled === true);
    const claims = isAdmin
      ? { role: "admin", accountStatus: "active", ...(account.clientId ? { clientId: account.clientId } : {}) }
      : {
        role: "customer",
        accountType: ACCOUNT_TYPES.OWNER,
        businessRole: "owner",
        clientId: account.clientId,
        accountStatus: account.status,
        billingPlan: "standard",
        messagesEnabled,
        identityVerificationRequired: account.identityVerificationRequired === true,
        identityVerificationVerified: account.identityVerificationVerified === true,
        termsAccepted: account.termsAccepted === true,
        privacyAccepted: account.privacyAccepted === true,
        termsVersion: String(account.termsVersion || ""),
        privacyVersion: String(account.privacyVersion || ""),
      };

    await auth.setCustomUserClaims(userRecord.uid, claims);
    if (isAdmin) {
      await db.collection("accounts").doc(userRecord.uid).set({
        uid: userRecord.uid,
        accountEmail: email,
        ownerName: account.ownerName || userRecord.displayName || "ARK Client Center Admin",
        businessName: account.businessName || "ARK Websites",
        clientId: account.clientId || "",
        role: "admin",
        status: "active",
        updatedAt: new Date(),
      }, { merge: true });
    }
    const token = await auth.createCustomToken(userRecord.uid, claims);
    return NextResponse.json({ token, role: isAdmin ? "admin" : "customer", accountType: claims.accountType || "admin", status: isAdmin ? "active" : account.status });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
