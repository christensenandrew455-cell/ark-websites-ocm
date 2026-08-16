import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";
import { accountCollection, accountRef, pendingSignupCollection } from "../../../lib/firestoreLayout";
import { MESSAGES_AVAILABLE } from "../../../lib/launchFeatures";
import { deletePendingOwnerSignup, pendingOwnerSignupExpired, readPendingOwnerSignup } from "../../../lib/pendingOwnerSignup";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { normalizeClientId } from "../../../lib/valueUtils";

const REGULAR_ACCOUNT_STATUSES = new Set(["active", "disabled"]);

async function resolveBusiness(db, identifier) {
  const clientId = normalizeClientId(identifier);
  if (!clientId) return null;
  const [snapshot, pending] = await Promise.all([
    accountRef(db, clientId).get(),
    readPendingOwnerSignup({ db, clientId, allowExpired: true }),
  ]);
  if (snapshot.exists) return { clientId, data: snapshot.data(), temporary: false };
  if (!pending) return null;
  const data = pending.data;
  const stage = String(data.stage || "");
  if (pendingOwnerSignupExpired(data)) {
    await deletePendingOwnerSignup({ db, auth: getAdminAuth(), uid: data.uid, pending }).catch((error) => {
      console.error(`Unable to remove expired temporary signup ${clientId}`, error);
    });
    return null;
  }
  if (!["pending_verification", "pending_business_setup", "pending_payment"].includes(stage) || normalizeClientId(data.clientId) !== clientId) return null;
  return {
    clientId,
    uid: String(data.uid || "").trim(),
    temporary: true,
    data: {
      ...data,
      status: stage,
      accountEmail: String(data.accountEmail || data.account?.accountEmail || "").trim().toLowerCase(),
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
    const [accountMatches, pendingMatches, adminSnapshot] = await Promise.all([
      accountCollection(db).where("uid", "==", userRecord.uid).limit(1).get(),
      pendingSignupCollection(db).where("uid", "==", userRecord.uid).limit(1).get(),
      accountRef(db, userRecord.uid).get(),
    ]);
    const matchedAccount = resolvedBusiness?.temporary
      ? null
      : (resolvedBusiness ? { id: resolvedBusiness.clientId, data: () => resolvedBusiness.data } : accountMatches.docs[0] || null);
    const account = matchedAccount?.data?.() || (adminSnapshot.exists ? adminSnapshot.data() : {});
    const isAdmin = getAdminEmails().has(email.toLowerCase()) || account.role === "admin";
    const accountClientId = normalizeClientId(account.clientId || matchedAccount?.id);

    const pendingDocument = resolvedBusiness?.temporary
      ? { data: () => ({ ...resolvedBusiness.data, uid: resolvedBusiness.uid, clientId: resolvedBusiness.clientId, stage: resolvedBusiness.data.status }) }
      : pendingMatches.docs[0] || null;
    if (!isAdmin && !matchedAccount && pendingDocument) {
      const pending = pendingDocument.data();
      if (String(pending.uid || "") === userRecord.uid && pendingOwnerSignupExpired(pending)) {
        await deletePendingOwnerSignup({
          db,
          auth,
          uid: userRecord.uid,
          pending: { data: pending, ref: pendingDocument.ref || null },
        });
        return NextResponse.json({ error: "This temporary signup expired. Start signup again." }, { status: 403 });
      }
      if (String(pending.uid || "") === userRecord.uid && ["pending_verification", "pending_business_setup", "pending_payment"].includes(String(pending.stage || ""))) {
        const claims = {
          role: ACCOUNT_ROLES.STANDARD,
          accountType: ACCOUNT_TYPES.OWNER,
          businessRole: "owner",
          clientId: pending.clientId,
          accountStatus: pending.stage,
          temporaryAccount: true,
          identityVerificationRequired: pending.identityVerificationVerified !== true,
          identityVerificationVerified: pending.identityVerificationVerified === true,
        };
        await auth.setCustomUserClaims(userRecord.uid, claims);
        return NextResponse.json({ token: await auth.createCustomToken(userRecord.uid, claims), role: ACCOUNT_ROLES.STANDARD, accountType: ACCOUNT_TYPES.OWNER, status: pending.stage });
      }
    }

    if (!isAdmin && (!matchedAccount || String(account.uid || "") !== userRecord.uid || !isStandardRole(account.role) || !REGULAR_ACCOUNT_STATUSES.has(String(account.status || "")) || !accountClientId)) {
      return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    }

    const messagesEnabled = MESSAGES_AVAILABLE && account.messagesEnabled === true;
    const claims = isAdmin
      ? { role: "admin", accountStatus: "active", ...(account.clientId ? { clientId: account.clientId } : {}) }
      : {
        role: ACCOUNT_ROLES.STANDARD,
        accountType: ACCOUNT_TYPES.OWNER,
        businessRole: "owner",
        clientId: accountClientId,
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
      await accountRef(db, userRecord.uid).set({
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
