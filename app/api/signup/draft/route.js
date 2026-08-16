import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_ROLES, isStandardRole } from "../../../lib/accountRoles";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { normalizeOwnerSignup, validateReceptionistBusinessInformation } from "../../../lib/ownerSignup";
import { deletePendingOwnerSignup, pendingOwnerSignupExpired, readPendingOwnerSignup } from "../../../lib/pendingOwnerSignup";

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
    if (pending.data.identityVerificationVerified !== true || !["pending_business_setup", "pending_payment"].includes(text(pending.data.stage))) {
      return { response: NextResponse.json({ error: "Verify your email and phone before entering business information.", nextPath: "/signup/verify" }, { status: 403 }) };
    }
    return { auth, db, decoded, pending };
  } catch (error) {
    if (text(error?.message) === "PENDING_SIGNUP_EXPIRED") return { response: expiredResponse() };
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
}

function profileFromPending(data = {}) {
  const account = data.account || data;
  const business = data.business || data;
  return {
    configured: data.businessSetupComplete === true,
    clientId: text(data.clientId),
    businessName: text(account.businessName || business.businessName),
    ownerName: text(account.ownerName || business.ownerName),
    businessEmail: text(account.accountEmail || business.businessEmail).toLowerCase(),
    businessPhone: text(account.accountPhone || business.businessPhone),
    timeZone: text(business.timeZone),
    estimateDays: text(business.estimateDays),
    estimateWeekdays: Array.isArray(business.estimateWeekdays) ? business.estimateWeekdays : [],
    earliestEstimateStart: text(business.earliestEstimateStart),
    latestEstimateStart: text(business.latestEstimateStart),
    businessBase: text(business.businessBase),
    serviceAreas: Array.isArray(business.serviceAreas) ? business.serviceAreas : [],
    services: business.services && typeof business.services === "object" && !Array.isArray(business.services) ? business.services : {},
    businessInformation: Array.isArray(business.businessInformation) ? business.businessInformation : [],
    extraInformation: text(business.extraInformation),
  };
}

export async function GET(request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  return NextResponse.json({ profile: profileFromPending(access.pending.data) });
}

export async function POST(request) {
  const access = await authorize(request);
  if (access.response) return access.response;

  try {
    const body = await request.json().catch(() => ({}));
    const account = access.pending.data.account || access.pending.data;
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

    const business = {
      ...normalized.receptionist,
      businessName: text(account.businessName),
      ownerName: text(account.ownerName),
      businessEmail: text(account.accountEmail).toLowerCase(),
      businessPhone: text(account.accountPhone),
    };
    const businessUpdate = { ...business };
    delete businessUpdate.businessName;
    delete businessUpdate.ownerName;
    delete businessUpdate.businessEmail;
    delete businessUpdate.businessPhone;
    await access.pending.ref.set({
      stage: "pending_payment",
      ...businessUpdate,
      businessSetupComplete: true,
      payment: {
        ...(access.pending.data.payment || {}),
        status: "ready",
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const userRecord = await access.auth.getUser(access.decoded.uid);
    await access.auth.setCustomUserClaims(access.decoded.uid, {
      ...(userRecord.customClaims || {}),
      role: ACCOUNT_ROLES.STANDARD,
      accountStatus: "pending_payment",
      temporaryAccount: true,
    });

    return NextResponse.json({
      profile: { ...profileFromPending({ ...access.pending.data, ...businessUpdate, businessSetupComplete: true }), configured: true },
      nextPath: "/signup/payment",
    });
  } catch (error) {
    console.error("Unable to save temporary business setup", error);
    return NextResponse.json({ error: "Unable to save business information right now." }, { status: 500 });
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
