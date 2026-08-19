import { NextResponse } from "next/server";
import { ACCOUNT_ROLES } from "../../../lib/accountRoles";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { missingAccountVerificationConfiguration, sendSignupVerificationCodes } from "../../../lib/accountVerification";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { normalizeOwnerSignup, validateOwnerAccountInformation } from "../../../lib/ownerSignup";
import { validateReferrerAccount } from "../../../lib/referrals";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { createSignupVerificationRequest, deleteSignupVerificationRequest } from "../../../lib/signupVerificationRequest";
import { checkSignupAvailability, normalizeSignupPhone, signupAvailabilityMessage } from "../../../lib/signupAvailability";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function safeSignupError(error) {
  const code = text(error?.code || error?.errorInfo?.code);
  const message = text(error?.message || error?.errorInfo?.message);
  if (code.includes("already-exists")) return { status: 409, message: "That business name, email address, or phone number was just registered. Use different information." };
  if (code === "auth/email-already-exists" || message === "EMAIL_TAKEN") return { status: 409, message: "That email address is already registered." };
  if (message === "PHONE_TAKEN") return { status: 409, message: "That phone number is already registered." };
  if (message === "BUSINESS_TAKEN") return { status: 409, message: "That business name is already registered. Use a different business name." };
  if (message === "SELF_REFERRAL") return { status: 400, message: "A business cannot refer its own account." };
  if (message === "REFERRER_NOT_FOUND") return { status: 400, message: "That referral account ID is not an active ARK account." };
  return { status: 500, message: "Unable to start account setup right now." };
}

export async function POST(request) {
  let createdUid = "";
  let verificationRequestSaved = false;
  try {
    const missingVerification = missingAccountVerificationConfiguration();
    if (missingVerification.length) {
      return NextResponse.json({ error: "Account verification is not available right now." }, { status: 503 });
    }

    const signup = normalizeOwnerSignup(await request.json().catch(() => ({})), { includePassword: true });
    const validationError = validateOwnerAccountInformation(signup);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const db = getAdminDb();
    const auth = getAdminAuth();
    const rateLimit = await checkRequestRateLimit({ db, request, scope: "owner-signup", limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const clientId = normalizeClientId(signup.businessName);
    const availability = await checkSignupAvailability({
      auth,
      db,
      businessName: signup.businessName,
      accountEmail: signup.accountEmail,
      accountPhone: signup.accountPhone,
    });
    const availabilityError = signupAvailabilityMessage(availability);
    if (availabilityError) return NextResponse.json({ error: availabilityError }, { status: 409 });

    const referrer = await validateReferrerAccount({
      db,
      referrerAccountId: signup.referrerAccountId,
      referredClientId: clientId,
    });
    const createdUser = await auth.createUser({
      email: signup.accountEmail,
      password: signup.password,
      displayName: signup.ownerName,
      emailVerified: false,
      disabled: false,
    });
    createdUid = createdUser.uid;

    const accountPhone = normalizeSignupPhone(signup.accountPhone);
    await createSignupVerificationRequest({
      db,
      uid: createdUid,
      clientId,
      signup: { ...signup, accountPhone },
      referrer,
    });
    verificationRequestSaved = true;

    const claims = {
      role: ACCOUNT_ROLES.STANDARD,
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      clientId,
      accountStatus: "pending_verification",
      temporaryAccount: false,
      signupVerification: true,
      identityVerificationRequired: true,
      identityVerificationVerified: false,
    };
    await auth.setCustomUserClaims(createdUid, claims);

    let verificationDelivery = "sent";
    try {
      await sendSignupVerificationCodes({
        db,
        uid: createdUid,
        clientId,
        email: signup.accountEmail,
        phone: signup.accountPhone,
      });
    } catch (error) {
      verificationDelivery = "needs_resend";
      console.error("Unable to deliver initial signup verification codes", error);
    }

    return NextResponse.json({
      token: await auth.createCustomToken(createdUid, claims),
      clientId,
      status: "pending_verification",
      verificationDelivery,
      nextPath: "/signup/verify",
    }, { status: 201 });
  } catch (error) {
    if (createdUid) {
      const auth = getAdminAuth();
      const rollback = verificationRequestSaved
        ? deleteSignupVerificationRequest({ db: getAdminDb(), auth, uid: createdUid })
        : auth.deleteUser(createdUid);
      await rollback.catch((rollbackError) => {
        console.error("Unable to roll back a failed temporary signup", rollbackError);
      });
    }
    console.error("Unable to create signup verification request", error);
    const safe = safeSignupError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
