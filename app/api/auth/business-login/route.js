import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { readAccountSections } from "../../../lib/accountSections";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { accountCollection, accountRef, pendingSignupCollection } from "../../../lib/firestoreLayout";
import { MESSAGES_AVAILABLE } from "../../../lib/launchFeatures";
import {
  deletePendingOwnerSignup,
  pendingOwnerSignupAccount,
  pendingOwnerSignupExpired,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "../../../lib/pendingOwnerSignup";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import {
  deleteSignupVerificationRequest,
  readSignupVerificationRequest,
  signupVerificationRequestAccount,
  signupVerificationRequestCollection,
  signupVerificationRequestExpired,
} from "../../../lib/signupVerificationRequest";
import { normalizeClientId } from "../../../lib/valueUtils";

const REGULAR_ACCOUNT_STATUSES = new Set(["active", "disabled"]);

async function resolveBusiness(db, identifier) {
  const clientId = normalizeClientId(identifier);
  if (!clientId) return null;
  const [snapshot, pending, verificationRequest] = await Promise.all([
    accountRef(db, clientId).get(),
    readPendingOwnerSignup({ db, clientId, allowExpired: true }),
    readSignupVerificationRequest({ db, clientId, allowExpired: true }),
  ]);
  if (snapshot.exists) return { clientId, data: snapshot.data(), temporary: false };
  if (pending) {
    const data = pending.data;
    const stage = String(data.stage || "");
    if (pendingOwnerSignupExpired(data)) {
      await deletePendingOwnerSignup({ db, auth: getAdminAuth(), uid: data.uid, pending }).catch((error) => {
        console.error(`Unable to remove expired temporary signup ${clientId}`, error);
      });
      return null;
    }
    if (!["pending_business_setup", "pending_payment"].includes(stage) || normalizeClientId(data.clientId) !== clientId) return null;
    return {
      clientId,
      uid: String(data.uid || "").trim(),
      temporary: true,
      data: {
        ...data,
        status: stage,
        accountEmail: String(pendingOwnerSignupAccount(data).accountEmail || "").trim().toLowerCase(),
      },
    };
  }
  if (!verificationRequest) return null;
  const data = verificationRequest.data;
  if (signupVerificationRequestExpired(data)) {
    await deleteSignupVerificationRequest({ db, auth: getAdminAuth(), uid: data.uid, request: verificationRequest }).catch((error) => {
      console.error(`Unable to remove expired signup verification request ${clientId}`, error);
    });
    return null;
  }
  if (String(data.stage || "") !== "pending_verification" || normalizeClientId(data.clientId) !== clientId) return null;
  return {
    clientId,
    uid: String(data.uid || "").trim(),
    temporary: false,
    signupVerification: true,
    data: {
      ...data,
      status: "pending_verification",
      accountEmail: String(signupVerificationRequestAccount(data).accountEmail || "").trim().toLowerCase(),
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
      if (!resolvedBusiness || (!resolvedBusiness.temporary && !resolvedBusiness.signupVerification && !REGULAR_ACCOUNT_STATUSES.has(String(resolvedBusiness.data.status || "")))) return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });
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
    const [accountMatches, pendingMatches, verificationMatches] = await Promise.all([
      accountCollection(db).where("uid", "==", userRecord.uid).limit(1).get(),
      pendingSignupCollection(db).where("uid", "==", userRecord.uid).limit(1).get(),
      signupVerificationRequestCollection(db).where("uid", "==", userRecord.uid).limit(1).get(),
    ]);
    const matchedAccount = resolvedBusiness?.temporary || resolvedBusiness?.signupVerification
      ? null
      : (resolvedBusiness ? { id: resolvedBusiness.clientId, data: () => resolvedBusiness.data } : accountMatches.docs[0] || null);
    const account = matchedAccount?.data?.() || {};
    const accountClientId = normalizeClientId(account.clientId || matchedAccount?.id);

    const verificationDocument = resolvedBusiness?.signupVerification
      ? { data: () => ({ ...resolvedBusiness.data, uid: resolvedBusiness.uid, clientId: resolvedBusiness.clientId, stage: "pending_verification" }) }
      : verificationMatches.docs[0] || null;
    if (!matchedAccount && verificationDocument) {
      const signupRequest = verificationDocument.data();
      if (String(signupRequest.uid || "") === userRecord.uid && signupVerificationRequestExpired(signupRequest)) {
        await deleteSignupVerificationRequest({
          db,
          auth,
          uid: userRecord.uid,
          request: { data: signupRequest, ref: verificationDocument.ref || null },
        });
        return NextResponse.json({ error: "This verification request expired. Start signup again." }, { status: 403 });
      }
      if (String(signupRequest.uid || "") === userRecord.uid && String(signupRequest.stage || "") === "pending_verification") {
        const claims = {
          role: ACCOUNT_ROLES.STANDARD,
          accountType: ACCOUNT_TYPES.OWNER,
          businessRole: "owner",
          clientId: signupRequest.clientId,
          accountStatus: "pending_verification",
          temporaryAccount: false,
          signupVerification: true,
          identityVerificationRequired: true,
          identityVerificationVerified: false,
        };
        await auth.setCustomUserClaims(userRecord.uid, claims);
        return NextResponse.json({ token: await auth.createCustomToken(userRecord.uid, claims), role: ACCOUNT_ROLES.STANDARD, accountType: ACCOUNT_TYPES.OWNER, status: "pending_verification" });
      }
    }

    const pendingDocument = resolvedBusiness?.temporary
      ? { data: () => ({ ...resolvedBusiness.data, uid: resolvedBusiness.uid, clientId: resolvedBusiness.clientId, stage: resolvedBusiness.data.status }) }
      : pendingMatches.docs[0] || null;
    if (!matchedAccount && pendingDocument) {
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
      if (String(pending.uid || "") === userRecord.uid && ["pending_business_setup", "pending_payment"].includes(String(pending.stage || ""))) {
        const verified = pendingOwnerSignupVerified(pending);
        const claims = {
          role: ACCOUNT_ROLES.STANDARD,
          accountType: ACCOUNT_TYPES.OWNER,
          businessRole: "owner",
          clientId: pending.clientId,
          accountStatus: pending.stage,
          temporaryAccount: true,
          signupVerification: false,
          identityVerificationRequired: !verified,
          identityVerificationVerified: verified,
        };
        await auth.setCustomUserClaims(userRecord.uid, claims);
        return NextResponse.json({ token: await auth.createCustomToken(userRecord.uid, claims), role: ACCOUNT_ROLES.STANDARD, accountType: ACCOUNT_TYPES.OWNER, status: pending.stage });
      }
    }

    if (!matchedAccount || String(account.uid || "") !== userRecord.uid || !isStandardRole(account.role) || !REGULAR_ACCOUNT_STATUSES.has(String(account.status || "")) || !accountClientId) {
      return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    }

    const accountSnapshot = await accountCollection(db).doc(accountClientId).get();
    const sections = await readAccountSections(accountSnapshot);
    const messagesEnabled = MESSAGES_AVAILABLE && sections.customization.messagesEnabled === true;
    const claims = {
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
    const token = await auth.createCustomToken(userRecord.uid, claims);
    return NextResponse.json({ token, role: ACCOUNT_ROLES.STANDARD, accountType: ACCOUNT_TYPES.OWNER, status: account.status });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
