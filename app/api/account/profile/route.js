import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { readAccountSections } from "../../../lib/accountSections";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { availableAccountFeatures } from "../../../lib/launchFeatures";
import {
  pendingOwnerSignupAccount,
  pendingOwnerSignupExpired,
  pendingOwnerSignupLegal,
  pendingOwnerSignupPersonalization,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "../../../lib/pendingOwnerSignup";
import {
  readSignupVerificationRequest,
  signupVerificationRequestAccount,
  signupVerificationRequestExpired,
  signupVerificationRequestLegal,
} from "../../../lib/signupVerificationRequest";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function onboardingGuideSeen(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    dashboard: source.dashboard === true,
    settings: source.settings === true,
    leads: source.leads === true,
  };
}

function ownerProfile({ account, decodedToken, clientId }) {
  const receptionistPhone = text(account.receptionistPhone || account.receptionistPhoneNormalized);
  return {
    uid: text(decodedToken.uid),
    email: text(decodedToken.email || account.accountEmail).toLowerCase(),
    accountEmail: text(account.accountEmail || decodedToken.email).toLowerCase(),
    accountPhone: text(account.accountPhone),
    role: account.role || decodedToken.role || ACCOUNT_ROLES.STANDARD,
    accountType: account.accountType || decodedToken.accountType || ACCOUNT_TYPES.OWNER,
    businessRole: text(account.businessRole || decodedToken.businessRole || "owner"),
    clientId,
    status: text(account.status || decodedToken.accountStatus || "active"),
    businessName: text(account.businessName || clientId),
    ownerName: text(account.ownerName),
    businessEmail: text(account.businessEmail || account.accountEmail).toLowerCase(),
    businessPhone: text(account.businessPhone || account.accountPhone),
    enabled: account.enabled !== false,
    receptionistPhone: text(account.receptionistPhone),
    receptionistPhoneNormalized: text(account.receptionistPhoneNormalized),
    numberAssignmentStatus: text(account.numberAssignmentStatus || (receptionistPhone ? "assigned" : "needed")),
    paymentSetupStatus: text(account.paymentSetupStatus),
    billingProvider: text(account.billingProvider || (account.appleOriginalTransactionId ? "apple" : "stripe")),
    billingPlanKey: text(account.billingPlanKey || "starter"),
    billingPlanName: text(account.billingPlanName || "Starter"),
    monthlyAcceptedLeadLimit: Math.max(0, Number(account.monthlyAcceptedLeadLimit || account.monthlyCallLimit || 50)),
    monthlyCallLimit: Math.max(0, Number(account.monthlyCallLimit || 50)),
    paymentMethodLabel: text(account.paymentMethodLabel),
    billingPastDue: account.billingPastDue === true,
    identityVerificationRequired: account.identityVerificationRequired === true || decodedToken.identityVerificationRequired === true,
    identityVerificationVerified: account.identityVerificationVerified === true || decodedToken.identityVerificationVerified === true,
    identityVerificationStatus: text(account.identityVerificationStatus),
    emailVerificationStatus: text(account.emailVerificationStatus),
    phoneVerificationStatus: text(account.phoneVerificationStatus),
    onboardingTourEligible: account.onboardingTourEligible === true,
    onboardingTourStatus: text(account.onboardingTourStatus),
    onboardingGuideVersion: Math.max(0, Math.floor(Number(account.onboardingGuideVersion || 0))),
    onboardingGuideSeen: onboardingGuideSeen(account.onboardingGuideSeen),
    onboardingNumberGuidePhone: text(account.onboardingNumberGuidePhone),
    darkMode: account.darkMode === true,
    notificationChannels: Array.isArray(account.notificationChannels) ? account.notificationChannels : [],
    notificationEmail: text(account.notificationEmail || account.accountEmail).toLowerCase(),
    notificationPhone: text(account.notificationPhone || account.accountPhone),
    notificationPreferencesCompleted: account.notificationPreferencesCompleted === true,
    nativeSetupPromptStatus: text(account.nativeSetupPromptStatus),
    termsAccepted: account.termsAccepted === true || decodedToken.termsAccepted === true,
    privacyAccepted: account.privacyAccepted === true || decodedToken.privacyAccepted === true,
    termsVersion: text(account.termsVersion || decodedToken.termsVersion),
    privacyVersion: text(account.privacyVersion || decodedToken.privacyVersion),
    ...availableAccountFeatures(account),
  };
}

function temporaryOwnerProfile({ pending, decodedToken, clientId }) {
  const account = pendingOwnerSignupAccount(pending);
  const legal = pendingOwnerSignupLegal(pending);
  const verified = pendingOwnerSignupVerified(pending);
  const storedStage = text(pending.stage || decodedToken.accountStatus || "pending_verification");
  const stage = storedStage === "pending_payment" && pendingOwnerSignupPersonalization(pending).notificationPreferencesCompleted !== true
    ? "pending_personalization"
    : storedStage;
  return {
    uid: text(decodedToken.uid),
    email: text(decodedToken.email || account.accountEmail).toLowerCase(),
    accountEmail: text(account.accountEmail || decodedToken.email).toLowerCase(),
    accountPhone: text(account.accountPhone),
    role: decodedToken.role || ACCOUNT_ROLES.STANDARD,
    accountType: decodedToken.accountType || ACCOUNT_TYPES.OWNER,
    businessRole: text(decodedToken.businessRole || "owner"),
    clientId,
    status: stage,
    businessName: text(account.businessName || clientId),
    ownerName: text(account.ownerName),
    messagesEnabled: false,
    notificationChannels: [],
    notificationPreferencesCompleted: false,
    paymentSetupStatus: text(pending.payment?.status),
    billingPlanKey: text(pending.payment?.billingPlanKey || "starter"),
    identityVerificationRequired: !verified,
    identityVerificationVerified: verified,
    identityVerificationStatus: verified ? "verified" : "pending",
    emailVerificationStatus: text(pending.verification?.emailStatus),
    phoneVerificationStatus: text(pending.verification?.phoneStatus),
    onboardingTourStatus: "",
    onboardingTourEligible: false,
    onboardingGuideVersion: 0,
    onboardingGuideSeen: onboardingGuideSeen(),
    onboardingNumberGuidePhone: "",
    numberAssignmentStatus: "",
    termsAccepted: legal.termsAccepted === true,
    privacyAccepted: legal.privacyAccepted === true,
    termsVersion: text(legal.termsVersion),
    privacyVersion: text(legal.privacyVersion),
  };
}

function signupVerificationProfile({ request, decodedToken, clientId }) {
  const account = signupVerificationRequestAccount(request);
  const legal = signupVerificationRequestLegal(request);
  return {
    uid: text(decodedToken.uid),
    email: text(decodedToken.email || account.accountEmail).toLowerCase(),
    accountEmail: text(account.accountEmail || decodedToken.email).toLowerCase(),
    accountPhone: text(account.accountPhone),
    role: decodedToken.role || ACCOUNT_ROLES.STANDARD,
    accountType: decodedToken.accountType || ACCOUNT_TYPES.OWNER,
    businessRole: text(decodedToken.businessRole || "owner"),
    clientId,
    status: "pending_verification",
    businessName: text(account.businessName || clientId),
    ownerName: text(account.ownerName),
    messagesEnabled: false,
    notificationChannels: [],
    notificationPreferencesCompleted: false,
    paymentSetupStatus: "",
    identityVerificationRequired: true,
    identityVerificationVerified: false,
    identityVerificationStatus: "pending",
    emailVerificationStatus: request.verification?.emailVerified === true ? "verified" : "pending",
    phoneVerificationStatus: request.verification?.phoneVerified === true ? "verified" : "pending",
    onboardingTourStatus: "",
    onboardingTourEligible: false,
    onboardingGuideVersion: 0,
    onboardingGuideSeen: onboardingGuideSeen(),
    onboardingNumberGuidePhone: "",
    numberAssignmentStatus: "",
    termsAccepted: legal.termsAccepted === true,
    privacyAccepted: legal.privacyAccepted === true,
    termsVersion: text(legal.termsVersion),
    privacyVersion: text(legal.privacyVersion),
  };
}

async function verifiedToken(request) {
  const authorization = text(request.headers.get("authorization"));
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in to the client center." }, { status: 401 }) };
  try {
    return { decodedToken: await getAdminAuth().verifyIdToken(token) };
  } catch (error) {
    console.error("Unable to verify profile token", error);
    return { response: NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 }) };
  }
}

export async function GET(request) {
  const user = await verifiedToken(request);
  if (user.response) return user.response;

  const decodedToken = user.decodedToken;
  const clientId = normalizeClientId(decodedToken.clientId);
  if (!isStandardRole(decodedToken.role) || !clientId) {
    return NextResponse.json({ error: "An owner account is required." }, { status: 403 });
  }

  try {
    const db = getAdminDb();
    const preVerification = decodedToken.signupVerification === true
      || (text(decodedToken.accountStatus) === "pending_verification" && decodedToken.temporaryAccount !== true);
    if (preVerification) {
      const request = await readSignupVerificationRequest({ db, uid: decodedToken.uid, clientId, allowExpired: true });
      if (request && !signupVerificationRequestExpired(request.data)) {
        return NextResponse.json(
          { profile: signupVerificationProfile({ request: request.data, decodedToken, clientId }) },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const promoted = await readPendingOwnerSignup({ db, uid: decodedToken.uid, clientId, allowExpired: true });
      if (promoted && !pendingOwnerSignupExpired(promoted.data)) {
        return NextResponse.json(
          { profile: temporaryOwnerProfile({ pending: promoted.data, decodedToken, clientId }) },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json({ error: "This verification request expired. Start signup again." }, { status: 410 });
    }
    const temporary = decodedToken.temporaryAccount === true
      || ["pending_business_setup", "pending_personalization", "pending_payment"].includes(text(decodedToken.accountStatus));
    if (temporary) {
      const pending = await readPendingOwnerSignup({ db, uid: decodedToken.uid, clientId, allowExpired: true });
      if (!pending || pendingOwnerSignupExpired(pending.data)) {
        return NextResponse.json({ error: "This temporary signup expired. Start signup again." }, { status: 410 });
      }
      return NextResponse.json(
        { profile: temporaryOwnerProfile({ pending: pending.data, decodedToken, clientId }) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const snapshot = await db.collection("accounts").doc(clientId).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    const account = snapshot.data();
    if (!isStandardRole(account.role) || text(account.uid) !== text(decodedToken.uid)) {
      return NextResponse.json({ error: "This owner account does not match the signed-in user." }, { status: 403 });
    }

    const sections = await readAccountSections(snapshot);
    return NextResponse.json(
      { profile: ownerProfile({ account: sections.combined, decodedToken, clientId }) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load owner account profile", error);
    return NextResponse.json({ error: "Could not load the business account." }, { status: 500 });
  }
}
