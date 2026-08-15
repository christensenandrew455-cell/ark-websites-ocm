import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, normalizePersonKey } from "../../../lib/accountTypes";
import { missingAccountVerificationConfiguration, sendAccountVerificationCodes } from "../../../lib/accountVerification";
import { newAccountVerificationDeadline } from "../../../lib/accountVerificationDeadline";
import { BILLING_PLAN_NAME, BILLING_VERSION, MESSAGE_PARTS_PER_BUNDLE, MONTHLY_BASE_CENTS, PER_CHAT_CENTS, PER_LEAD_CENTS, PER_MESSAGE_BUNDLE_CENTS } from "../../../lib/billingPricing";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PHONE_VERIFICATION_REQUIRED } from "../../../lib/launchFeatures";
import { normalizeOwnerSignup, validateOwnerAccountInformation } from "../../../lib/ownerSignup";
import { pendingReferralFields, validateReferrerAccount } from "../../../lib/referrals";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { accountPhoneRegistryId, checkSignupAvailability, normalizeSignupPhone, signupAvailabilityMessage } from "../../../lib/signupAvailability";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function safeSignupError(error) {
  const code = text(error?.code || error?.errorInfo?.code);
  const message = text(error?.message || error?.errorInfo?.message);
  if (code === "auth/email-already-exists" || message === "EMAIL_TAKEN") return { status: 409, message: "That email address is already registered." };
  if (message === "PHONE_TAKEN") return { status: 409, message: "That phone number is already registered." };
  if (message === "BUSINESS_TAKEN") return { status: 409, message: "That business name is already registered. Use a different business name." };
  if (message === "SELF_REFERRAL") return { status: 400, message: "A business cannot refer its own account." };
  if (message === "REFERRER_NOT_FOUND") return { status: 400, message: "That referral account ID is not an active ARK account." };
  return { status: 500, message: "Unable to create the account right now." };
}

export async function POST(request) {
  let createdUid = "";
  let accountPersisted = false;
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

    const uid = createdUser.uid;
    const accountPhoneNormalized = normalizeSignupPhone(signup.accountPhone);
    const accountRef = db.collection("accounts").doc(uid);
    const businessRef = db.collection("businesses").doc(clientId);
    const registryRef = db.collection("businessNameRegistry").doc(clientId);
    const phoneRegistryRef = db.collection("accountPhoneRegistry").doc(accountPhoneRegistryId(accountPhoneNormalized));
    const clientRef = db.collection("ocmClients").doc(clientId);
    const verificationDeadline = newAccountVerificationDeadline();
    const acceptedAt = new Date();

    const verificationFields = {
      verificationStatus: "pending",
      identityVerificationRequired: true,
      identityVerificationVerified: false,
      identityVerificationStatus: "pending",
      identityVerificationDeadlineAt: verificationDeadline,
      emailVerificationStatus: "pending",
      phoneVerificationStatus: PHONE_VERIFICATION_REQUIRED ? "pending" : "not_required",
    };
    const billingFields = {
      billingPlan: "standard",
      billingPlanName: BILLING_PLAN_NAME,
      billingVersion: BILLING_VERSION,
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      includedLeads: 0,
      includedConversations: 0,
      perLeadCents: PER_LEAD_CENTS,
      perCallCents: PER_LEAD_CENTS,
      perChatCents: PER_CHAT_CENTS,
      perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
      messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    };
    const common = {
      uid,
      ownerUid: uid,
      clientId,
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      businessName: signup.businessName,
      businessNameKey: clientId,
      ownerName: signup.ownerName,
      ownerNameKey: normalizePersonKey(signup.ownerName),
      accountEmail: signup.accountEmail,
      accountPhone: signup.accountPhone,
      accountPhoneNormalized,
      status: "pending_verification",
      businessSetupComplete: false,
      paymentSetupStatus: "not_started",
      messagesEnabled: false,
      ...verificationFields,
      ...billingFields,
      ...pendingReferralFields(referrer),
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
      legalAcceptedAt: acceptedAt,
      legalAcceptedBy: signup.accountEmail,
      legalAcceptanceSource: "owner-signup",
      legalRecordedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (transaction) => {
      const [businessSnapshot, registrySnapshot, phoneSnapshot] = await Promise.all([
        transaction.get(businessRef),
        transaction.get(registryRef),
        transaction.get(phoneRegistryRef),
      ]);
      if (businessSnapshot.exists || registrySnapshot.exists) throw new Error("BUSINESS_TAKEN");
      if (phoneSnapshot.exists) throw new Error("PHONE_TAKEN");

      transaction.create(accountRef, common);
      transaction.create(businessRef, common);
      transaction.create(registryRef, {
        clientId,
        businessName: signup.businessName,
        ownerUid: uid,
        status: "reserved",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(phoneRegistryRef, {
        uid,
        ownerUid: uid,
        clientId,
        accountPhoneNormalized,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(clientRef, {
        ownerUid: uid,
        clientId,
        businessName: signup.businessName,
        accountType: ACCOUNT_TYPES.OWNER,
        status: "pending_verification",
        businessSetupComplete: false,
        paymentSetupStatus: "not_started",
        messagesEnabled: false,
        ...verificationFields,
        ...billingFields,
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: signup.termsVersion,
        privacyVersion: signup.privacyVersion,
        legalAcceptedAt: acceptedAt,
        legalAcceptedBy: signup.accountEmail,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(clientRef.collection("settings").doc("account"), {
        BusinessName: signup.businessName,
        OwnerName: signup.ownerName,
        AccountEmail: signup.accountEmail,
        AccountPhone: signup.accountPhone,
        BillingEmail: signup.accountEmail,
        BillingStatus: "Payment setup pending",
        AccountType: ACCOUNT_TYPES.OWNER,
        BillingPlan: "standard",
        BillingPlanName: BILLING_PLAN_NAME,
        BillingVersion: BILLING_VERSION,
        MonthlyBaseCents: MONTHLY_BASE_CENTS,
        IncludedLeads: 0,
        IncludedConversations: 0,
        PerLeadCents: PER_LEAD_CENTS,
        PerCallCents: PER_LEAD_CENTS,
        PerChatCents: PER_CHAT_CENTS,
        PerMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
        MessagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
        IdentityVerificationStatus: "Pending",
        IdentityVerificationDeadlineAt: verificationDeadline,
        EmailVerificationStatus: "Pending",
        PhoneVerificationStatus: PHONE_VERIFICATION_REQUIRED ? "Pending" : "Not Required",
        TermsAccepted: true,
        PrivacyAccepted: true,
        TermsVersion: signup.termsVersion,
        PrivacyVersion: signup.privacyVersion,
        LegalAcceptedAt: acceptedAt,
        LegalAcceptedBy: signup.accountEmail,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(clientRef.collection("settings").doc("receptionist"), {
        clientId,
        enabled: false,
        businessSetupComplete: false,
        businessName: signup.businessName,
        ownerName: signup.ownerName,
        businessPhone: signup.accountPhone,
        businessEmail: signup.accountEmail,
        serviceAreas: [],
        services: {},
        businessInformation: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    accountPersisted = true;

    const claims = {
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      clientId,
      accountStatus: "pending_verification",
      billingPlan: "standard",
      messagesEnabled: false,
      identityVerificationRequired: true,
      identityVerificationVerified: false,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
    };
    await auth.setCustomUserClaims(uid, claims);

    let verificationDelivery = "sent";
    try {
      await sendAccountVerificationCodes({
        db,
        uid,
        clientId,
        email: signup.accountEmail,
        phone: signup.accountPhone,
      });
    } catch (error) {
      verificationDelivery = "needs_resend";
      console.error("Unable to deliver initial account verification codes", error);
    }

    return NextResponse.json({
      token: await auth.createCustomToken(uid, claims),
      clientId,
      status: "pending_verification",
      verificationDelivery,
      nextPath: "/signup/verify",
    }, { status: 201 });
  } catch (error) {
    if (createdUid && !accountPersisted) {
      await getAdminAuth().deleteUser(createdUid).catch((rollbackError) => {
        console.error("Unable to roll back a failed signup user", rollbackError);
      });
    }
    console.error("Unable to create owner signup", error);
    const safe = safeSignupError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
