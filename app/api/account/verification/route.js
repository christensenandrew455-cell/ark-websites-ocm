import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { accountRef } from "../../../lib/firestoreLayout";
import {
  readAccountVerificationStatus,
  readPendingSignupVerificationStatus,
  readSignupVerificationStatus,
  sendAccountVerificationCodes,
  sendSignupVerificationCodes,
  updateAccountVerificationContact,
  updateSignupVerificationContact,
  verifyAccountCodes,
  verifySignupCodes,
} from "../../../lib/accountVerification";
import { PHONE_VERIFICATION_REQUIRED } from "../../../lib/launchFeatures";
import { pendingOwnerSignupAccount, readPendingOwnerSignup } from "../../../lib/pendingOwnerSignup";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { readSignupVerificationRequest, signupVerificationRequestAccount } from "../../../lib/signupVerificationRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

async function statusWithContinuation(authorization, status) {
  if (status?.verified !== true) return status;
  const accountStatus = text(status.accountStatus);
  const onboarding = authorization.signupVerification || authorization.temporary;
  if (onboarding && !["pending_business_setup", "pending_payment"].includes(accountStatus)) {
    return { ...status, verified: false, nextPath: "/signup/verify" };
  }
  if (!onboarding) return status;

  const auth = getAdminAuth();
  const user = await auth.getUser(authorization.decoded.uid);
  const claims = {
    ...(user.customClaims || {}),
    role: ACCOUNT_ROLES.STANDARD,
    clientId: authorization.clientId,
    accountStatus,
    temporaryAccount: true,
    signupVerification: false,
    identityVerificationRequired: false,
    identityVerificationVerified: true,
  };
  // Repair a stale token as part of resume as well as immediately after code
  // submission. This keeps app backgrounding from losing the verified step.
  await auth.setCustomUserClaims(authorization.decoded.uid, claims);
  return {
    ...status,
    continuationToken: await auth.createCustomToken(authorization.decoded.uid, claims),
  };
}

async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in to verify your account." }, { status: 401 }) };
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    const clientId = text(decoded.clientId);
    if (!clientId) return { response: NextResponse.json({ error: "An active owner account in verification is required." }, { status: 403 }) };
    const db = getAdminDb();
    const preVerification = decoded.signupVerification === true
      || (text(decoded.accountStatus) === "pending_verification" && decoded.temporaryAccount !== true);
    if (preVerification) {
      const verificationRequest = await readSignupVerificationRequest({ db, uid: decoded.uid, clientId, allowExpired: true });
      if (verificationRequest && text(verificationRequest.data.stage) === "pending_verification") {
        return {
          decoded,
          account: signupVerificationRequestAccount(verificationRequest.data),
          clientId,
          verificationRequest,
          signupVerification: true,
          temporary: false,
        };
      }
      const promoted = await readPendingOwnerSignup({ db, uid: decoded.uid, clientId, allowExpired: true });
      if (promoted && ["pending_business_setup", "pending_payment"].includes(text(promoted.data.stage))) {
        return { decoded, account: pendingOwnerSignupAccount(promoted.data), clientId, pending: promoted, signupVerification: false, temporary: true };
      }
      return { response: NextResponse.json({ error: "A signup verification request is required." }, { status: 403 }) };
    }
    if (decoded.temporaryAccount === true) {
      const pending = await readPendingOwnerSignup({ db, uid: decoded.uid, clientId, allowExpired: true });
      const stage = text(pending?.data?.stage);
      if (!pending || !["pending_business_setup", "pending_payment"].includes(stage)) {
        return { response: NextResponse.json({ error: "A temporary owner account in verification is required." }, { status: 403 }) };
      }
      return { decoded, account: pendingOwnerSignupAccount(pending.data), clientId, pending, signupVerification: false, temporary: true };
    }
    const accountSnapshot = await accountRef(db, clientId).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : null;
    if (!account || text(account.uid) !== text(decoded.uid) || !isStandardRole(account.role) || account.status !== "active") return { response: NextResponse.json({ error: "An active owner account in verification is required." }, { status: 403 }) };
    return { decoded, account, clientId, temporary: false };
  } catch {
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
}

function verificationError(error) {
  const message = text(error?.message);
  if (message === "ACCOUNT_EMAIL_INVALID") return { status: 400, error: "Enter a valid email address." };
  if (message === "ACCOUNT_PHONE_INVALID") return { status: 400, error: "Enter a valid 10-digit U.S. phone number." };
  if (message === "EMAIL_TAKEN") return { status: 409, error: "That email address is already registered." };
  if (message === "PHONE_TAKEN") return { status: 409, error: "That phone number is already registered." };
  if (message === "BUSINESS_TAKEN" || message === "SIGNUP_IDENTITY_ALREADY_EXISTS") return { status: 409, error: "That business name, email, or phone number was just registered. Start signup again with available information." };
  if (message === "ACCOUNT_ALREADY_VERIFIED") return { status: 409, error: "This account is already verified." };
  if (message === "ACCOUNT_VERIFICATION_EXPIRED") return { status: 410, error: "The one-hour verification window expired. This account is locked and will be deleted. Sign out and start signup again." };
  if (message === "VERIFICATION_RESEND_COOLDOWN") return { status: 429, error: "Please wait before requesting another code.", resendAvailableAt: error.resendAvailableAt?.toISOString?.() || "" };
  if (message === "VERIFICATION_CODE_INVALID") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "Enter both four-digit codes." : "Enter the four-digit email code." };
  if (message === "VERIFICATION_CODE_EXPIRED") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "Those codes expired. Request new codes." : "That code expired. Request a new code." };
  if (message === "VERIFICATION_CODE_INCORRECT") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "One or both codes are incorrect." : "That email code is incorrect.", emailCorrect: error.emailCorrect === true, phoneCorrect: error.phoneCorrect === true };
  if (message === "VERIFICATION_TOO_MANY_ATTEMPTS") return { status: 429, error: "Too many incorrect attempts. Request new codes." };
  if (message === "VERIFICATION_CONTACT_CHANGED") return { status: 409, error: "Your email or phone changed. Enter the newest codes." };
  if (message === "VERIFICATION_DELIVERY_FAILED") return { status: 502, error: PHONE_VERIFICATION_REQUIRED ? "One or both codes could not be delivered. Check your connection and try Resend." : "The email code could not be delivered. Check your connection and try Resend.", delivery: error.delivery };
  if (message.startsWith("ACCOUNT_VERIFICATION_NOT_CONFIGURED")) return { status: 503, error: "Account verification is not available right now." };
  return { status: 500, error: "Something went wrong. Reload and try again." };
}

export async function GET(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  try {
    const readStatus = authorization.signupVerification
      ? readSignupVerificationStatus
      : authorization.temporary
        ? readPendingSignupVerificationStatus
        : readAccountVerificationStatus;
    const status = await readStatus({ db: getAdminDb(), uid: authorization.decoded.uid, clientId: authorization.clientId });
    return NextResponse.json(await statusWithContinuation(authorization, status));
  } catch (error) {
    const safe = verificationError(error);
    return NextResponse.json(safe, { status: safe.status });
  }
}

export async function POST(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  try {
    const body = await request.json().catch(() => ({}));
    const db = getAdminDb();
    const action = text(body.action).toLowerCase();
    const limits = {
      resend: { scope: "account-verification-resend", limit: 6, windowMs: 60 * 60 * 1000 },
      verify: { scope: "account-verification-check", limit: 10, windowMs: 10 * 60 * 1000 },
      "update-contact": { scope: "account-verification-contact", limit: 4, windowMs: 60 * 60 * 1000 },
    };
    const selectedLimit = limits[action];
    if (!selectedLimit) return NextResponse.json({ error: "Choose a verification action." }, { status: 400 });
    const rateLimit = await checkRequestRateLimit({ db, request, scope: `${selectedLimit.scope}:${authorization.decoded.uid}`, limit: selectedLimit.limit, windowMs: selectedLimit.windowMs });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    if (authorization.temporary) throw new Error("ACCOUNT_ALREADY_VERIFIED");
    if (action === "resend") {
      const sendCodes = authorization.signupVerification ? sendSignupVerificationCodes : sendAccountVerificationCodes;
      return NextResponse.json(await sendCodes({
        db,
        uid: authorization.decoded.uid,
        clientId: authorization.clientId,
        email: text(authorization.account.accountEmail).toLowerCase(),
        phone: text(authorization.account.accountPhone),
      }));
    }
    if (action === "update-contact") {
      const updateContact = authorization.signupVerification ? updateSignupVerificationContact : updateAccountVerificationContact;
      return NextResponse.json(await updateContact({
        db,
        auth: getAdminAuth(),
        uid: authorization.decoded.uid,
        clientId: authorization.clientId,
        email: body.email,
        phone: body.phone,
      }));
    }
    const verifyCodes = authorization.signupVerification ? verifySignupCodes : verifyAccountCodes;
    const status = await verifyCodes({
      db,
      auth: getAdminAuth(),
      uid: authorization.decoded.uid,
      clientId: authorization.clientId,
      emailCode: body.emailCode,
      phoneCode: body.phoneCode,
    });
    return NextResponse.json(await statusWithContinuation(authorization, status));
  } catch (error) {
    console.error("Unable to verify owner account", error);
    const safe = verificationError(error);
    return NextResponse.json(safe, { status: safe.status });
  }
}
