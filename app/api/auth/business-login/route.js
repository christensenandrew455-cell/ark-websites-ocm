import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";
import { MESSAGES_AVAILABLE } from "../../../lib/launchFeatures";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { normalizeClientId } from "../../../lib/valueUtils";

const REGULAR_ACCOUNT_STATUSES = new Set(["active", "disabled"]);

async function resolveBusiness(db, identifier) {
  const requestedKey = normalizeClientId(identifier);
  if (!requestedKey) return null;
  const registrySnapshot = await db.collection("businessNameRegistry").doc(requestedKey).get();
  const registry = registrySnapshot.exists ? registrySnapshot.data() : {};
  const clientId = normalizeClientId(registry.clientId || requestedKey);
  const snapshot = await db.collection("businesses").doc(clientId).get();
  if (snapshot.exists) return { clientId, data: snapshot.data(), temporary: false };

  const ownerUid = String(registry.ownerUid || "").trim();
  if (!ownerUid) return null;
  const pendingSnapshot = await db.collection("pendingOwnerSignups").doc(ownerUid).get();
  if (!pendingSnapshot.exists) return null;
  const pending = pendingSnapshot.data();
  const expiresAt = typeof pending.expiresAt?.toMillis === "function" ? pending.expiresAt.toMillis() : new Date(pending.expiresAt || 0).getTime();
  const stage = String(pending.stage || "");
  if (expiresAt <= Date.now() || !["pending_business_setup", "pending_payment"].includes(stage) || normalizeClientId(pending.clientId) !== clientId) return null;
  return {
    clientId,
    ownerUid,
    temporary: true,
    data: {
      status: stage,
      accountEmail: String(pending.account?.accountEmail || "").trim().toLowerCase(),
    },
  };
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
      if (!resolvedBusiness || (!resolvedBusiness.temporary && !REGULAR_ACCOUNT_STATUSES.has(String(resolvedBusiness.data.status || "")))) return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });
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
    const [accountSnapshot, pendingSnapshot] = await Promise.all([
      db.collection("accounts").doc(userRecord.uid).get(),
      db.collection("pendingOwnerSignups").doc(userRecord.uid).get(),
    ]);
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const isAdmin = getAdminEmails().has(email.toLowerCase()) || account.role === "admin";
    let business = resolvedBusiness?.temporary ? null : resolvedBusiness?.data || null;
    if (!isAdmin && account.clientId && !business) {
      const businessSnapshot = await db.collection("businesses").doc(String(account.clientId)).get();
      business = businessSnapshot.exists ? businessSnapshot.data() : null;
    }

    if (!isAdmin && !accountSnapshot.exists && pendingSnapshot.exists) {
      const pending = pendingSnapshot.data();
      const expiresAt = typeof pending.expiresAt?.toMillis === "function" ? pending.expiresAt.toMillis() : new Date(pending.expiresAt || 0).getTime();
      if (expiresAt > Date.now() && ["pending_business_setup", "pending_payment"].includes(String(pending.stage || ""))) {
        const claims = {
          role: ACCOUNT_ROLES.STANDARD,
          accountType: ACCOUNT_TYPES.OWNER,
          businessRole: "owner",
          clientId: pending.clientId,
          accountStatus: pending.stage,
          temporaryAccount: true,
        };
        await auth.setCustomUserClaims(userRecord.uid, claims);
        return NextResponse.json({ token: await auth.createCustomToken(userRecord.uid, claims), role: ACCOUNT_ROLES.STANDARD, accountType: ACCOUNT_TYPES.OWNER, status: pending.stage });
      }
    }

    if (!isAdmin && (!accountSnapshot.exists || !isStandardRole(account.role) || !REGULAR_ACCOUNT_STATUSES.has(String(account.status || "")) || !account.clientId)) {
      return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    }

    const messagesEnabled = MESSAGES_AVAILABLE && (business?.messagesEnabled === true || account.messagesEnabled === true);
    const claims = isAdmin
      ? { role: "admin", accountStatus: "active", ...(account.clientId ? { clientId: account.clientId } : {}) }
      : {
        role: ACCOUNT_ROLES.STANDARD,
        accountType: ACCOUNT_TYPES.OWNER,
        businessRole: "owner",
        clientId: account.clientId,
        accountStatus: account.status,
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
    return NextResponse.json({ token, role: isAdmin ? ACCOUNT_ROLES.ADMIN : ACCOUNT_ROLES.STANDARD, accountType: claims.accountType || "admin", status: isAdmin ? "active" : account.status });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
