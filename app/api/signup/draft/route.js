import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { normalizeEmergencyServiceSettings } from "../../../lib/emergencyService";
import { normalizeOwnerSignup, validateReceptionistBusinessInformation } from "../../../lib/ownerSignup";
import { normalizeNotificationPreferences, notificationPreferenceError } from "../../../lib/notificationPreferences";
import {
  deletePendingOwnerSignup,
  pendingOwnerSignupAccount,
  pendingOwnerSignupBusiness,
  pendingOwnerSignupExpired,
  pendingOwnerSignupLegal,
  pendingOwnerSignupPersonalization,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
  retiredPendingOwnerSignupFieldDeletes,
} from "../../../lib/pendingOwnerSignup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function expiredResponse() {
  return NextResponse.json({ error: "This temporary signup expired. Sign out and start again." }, { status: 410 });
}

async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in to continue account setup." }, { status: 401 }) };

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(token, true);
    if (!isStandardRole(decoded.role) || decoded.temporaryAccount !== true) {
      return { response: NextResponse.json({ error: "A temporary owner account is required." }, { status: 403 }) };
    }
    const db = getAdminDb();
    const pending = await readPendingOwnerSignup({ db, uid: decoded.uid, allowExpired: true });
    if (!pending) return { response: NextResponse.json({ error: "This temporary signup no longer exists." }, { status: 404 }) };
    if (pendingOwnerSignupExpired(pending.data)) {
      await deletePendingOwnerSignup({ db, auth, uid: decoded.uid, pending });
      return { response: expiredResponse() };
    }
    if (!pendingOwnerSignupVerified(pending.data) || !["pending_business_setup", "pending_personalization", "pending_payment"].includes(text(pending.data.stage))) {
      return { response: NextResponse.json({ error: "Verify your email and phone before entering business information.", nextPath: "/signup/verify" }, { status: 403 }) };
    }
    return { auth, db, decoded, pending };
  } catch (error) {
    if (text(error?.message) === "PENDING_SIGNUP_EXPIRED") return { response: expiredResponse() };
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
}

function profileFromPending(data = {}) {
  const account = pendingOwnerSignupAccount(data);
  const business = pendingOwnerSignupBusiness(data);
  return {
    configured: text(data.stage) !== "pending_business_setup",
    clientId: text(data.clientId),
    businessName: text(account.businessName || business.businessName),
    ownerName: text(account.ownerName || business.ownerName),
    businessEmail: text(account.accountEmail || business.businessEmail).toLowerCase(),
    businessPhone: text(account.accountPhone || business.businessPhone),
    timeZone: text(business.timeZone),
    estimateWeekdays: Array.isArray(business.estimateWeekdays) ? business.estimateWeekdays : [],
    earliestEstimateStart: text(business.earliestEstimateStart),
    latestEstimateStart: text(business.latestEstimateStart),
    ...normalizeEmergencyServiceSettings(business),
    businessType: text(business.businessType || business.businessBase),
    serviceAreas: Array.isArray(business.serviceAreas) ? business.serviceAreas : [],
    services: business.services && typeof business.services === "object" && !Array.isArray(business.services) ? business.services : {},
    businessInformation: Array.isArray(business.businessInformation) ? business.businessInformation : [],
    extraInformation: text(business.extraInformation),
  };
}

export async function GET(request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  const account = pendingOwnerSignupAccount(access.pending.data);
  return NextResponse.json({
    profile: profileFromPending(access.pending.data),
    personalization: normalizeNotificationPreferences(pendingOwnerSignupPersonalization(access.pending.data), account),
  });
}

export async function POST(request) {
  const access = await authorize(request);
  if (access.response) return access.response;

  try {
    const body = await request.json().catch(() => ({}));
    const submittedValidationError = validateReceptionistBusinessInformation(body);
    if (submittedValidationError) return NextResponse.json({ error: submittedValidationError }, { status: 400 });
    const account = pendingOwnerSignupAccount(access.pending.data);
    const normalized = normalizeOwnerSignup({
      businessName: account.businessName,
      ownerName: account.ownerName,
      accountEmail: account.accountEmail,
      accountPhone: account.accountPhone,
      receptionist: {
        ...body,
        businessName: account.businessName,
        ownerName: account.ownerName,
        businessEmail: account.accountEmail,
        businessPhone: account.accountPhone,
      },
    }, { includePassword: false });
    const validationError = validateReceptionistBusinessInformation(normalized.receptionist);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const business = normalized.receptionist;
    const businessUpdate = {
      timeZone: text(business.timeZone),
      businessType: text(business.businessType),
      estimateWeekdays: Array.isArray(business.estimateWeekdays) ? business.estimateWeekdays : [],
      earliestEstimateStart: text(business.earliestEstimateStart),
      latestEstimateStart: text(business.latestEstimateStart),
      emergencyServiceEnabled: business.emergencyServiceEnabled === true,
      emergencyService24Hours: business.emergencyService24Hours === true,
      serviceAreas: Array.isArray(business.serviceAreas) ? business.serviceAreas : [],
      services: business.services && typeof business.services === "object" && !Array.isArray(business.services) ? business.services : {},
      businessInformation: Array.isArray(business.businessInformation) ? business.businessInformation : [],
      extraInformation: text(business.extraInformation),
    };
    await access.pending.ref.update({
      stage: "pending_personalization",
      account,
      legal: pendingOwnerSignupLegal(access.pending.data),
      business: businessUpdate,
      personalization: pendingOwnerSignupPersonalization(access.pending.data),
      payment: { status: "not_started" },
      ...retiredPendingOwnerSignupFieldDeletes(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userRecord = await access.auth.getUser(access.decoded.uid);
    const claims = {
      ...(userRecord.customClaims || {}),
      role: ACCOUNT_ROLES.STANDARD,
      accountStatus: "pending_personalization",
      temporaryAccount: true,
    };
    await access.auth.setCustomUserClaims(access.decoded.uid, claims);

    return NextResponse.json({
      profile: { ...profileFromPending({ ...access.pending.data, stage: "pending_personalization", account, business: businessUpdate }), configured: true },
      nextPath: "/setup/personalization",
      continuationToken: await access.auth.createCustomToken(access.decoded.uid, claims),
    });
  } catch (error) {
    console.error("Unable to save temporary business setup", error);
    return NextResponse.json({ error: "Unable to save business information right now." }, { status: 500 });
  }
}

export async function PUT(request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  if (!["pending_personalization", "pending_payment"].includes(text(access.pending.data.stage))) {
    return NextResponse.json({ error: "Finish business information before choosing notifications.", nextPath: "/setup/business" }, { status: 409 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const account = pendingOwnerSignupAccount(access.pending.data);
    const validationError = notificationPreferenceError(body, account);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const preferences = normalizeNotificationPreferences({ ...body, notificationPreferencesCompleted: true }, account);
    const previous = pendingOwnerSignupPersonalization(access.pending.data);
    const personalization = {
      ...preferences,
      notificationPreferencesCompleted: true,
      notificationSmsConsentAt: preferences.notificationChannels.includes("sms")
        ? previous.notificationSmsConsentAt || FieldValue.serverTimestamp()
        : null,
      notificationPreferencesUpdatedAt: FieldValue.serverTimestamp(),
    };
    await access.pending.ref.update({
      stage: "pending_payment",
      personalization,
      payment: { ...(access.pending.data.payment || {}), status: "ready" },
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userRecord = await access.auth.getUser(access.decoded.uid);
    const claims = {
      ...(userRecord.customClaims || {}),
      role: ACCOUNT_ROLES.STANDARD,
      accountStatus: "pending_payment",
      temporaryAccount: true,
    };
    await access.auth.setCustomUserClaims(access.decoded.uid, claims);
    return NextResponse.json({
      personalization: preferences,
      nextPath: "/signup/payment",
      continuationToken: await access.auth.createCustomToken(access.decoded.uid, claims),
    });
  } catch (error) {
    console.error("Unable to save signup personalization", error);
    return NextResponse.json({ error: "Unable to save notification preferences right now." }, { status: 500 });
  }
}

export async function DELETE(request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  try {
    await deletePendingOwnerSignup({ db: access.db, auth: access.auth, uid: access.decoded.uid, pending: access.pending.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to cancel temporary signup", error);
    return NextResponse.json({ error: "Unable to cancel this temporary signup right now." }, { status: 500 });
  }
}
