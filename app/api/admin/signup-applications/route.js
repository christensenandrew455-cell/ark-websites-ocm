import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPLICATION_STATUSES = new Set([
  "pending_verification",
  "approved_pending_payment",
  "declined",
]);

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function payload(id, data) {
  return {
    clientId: id,
    uid: text(data.uid),
    businessName: text(data.businessName || id),
    ownerName: text(data.ownerName),
    accountEmail: text(data.accountEmail).toLowerCase(),
    accountPhone: text(data.accountPhone),
    status: text(data.status || "pending_verification"),
    verificationStatus: text(data.verificationStatus || "pending"),
    paymentSetupStatus: text(data.paymentSetupStatus || "awaiting_verification"),
    termsAccepted: data.termsAccepted === true,
    privacyAccepted: data.privacyAccepted === true,
    termsVersion: text(data.termsVersion),
    privacyVersion: text(data.privacyVersion),
    legalAcceptedAt: iso(data.legalAcceptedAt),
    createdAt: iso(data.createdAt),
    verifiedAt: iso(data.verifiedAt),
    declinedAt: iso(data.declinedAt),
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const snapshot = await getAdminDb().collection("businesses").get();
  const applications = snapshot.docs
    .map((document) => payload(document.id, document.data()))
    .filter((application) => APPLICATION_STATUSES.has(application.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return NextResponse.json({ applications });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const { clientId: rawClientId, action: rawAction } = await request.json();
  const clientId = text(rawClientId).toLowerCase();
  const action = text(rawAction).toLowerCase();

  if (!clientId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Choose an application and an approval action." }, { status: 400 });
  }

  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) {
    return NextResponse.json({ error: "That account application no longer exists." }, { status: 404 });
  }

  const business = businessSnapshot.data();
  const uid = text(business.uid);
  if (!uid) {
    return NextResponse.json({ error: "That application is missing its account owner." }, { status: 409 });
  }
  if (!APPLICATION_STATUSES.has(text(business.status))) {
    return NextResponse.json({ error: "That account is no longer awaiting verification." }, { status: 409 });
  }

  const accountRef = db.collection("accounts").doc(uid);
  const nowFields = action === "accept"
    ? {
        status: "approved_pending_payment",
        verificationStatus: "approved",
        paymentSetupStatus: "awaiting_payment_method",
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: admin.decodedToken.uid,
        declinedAt: FieldValue.delete(),
        declinedBy: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }
    : {
        status: "declined",
        verificationStatus: "declined",
        paymentSetupStatus: "blocked",
        declinedAt: FieldValue.serverTimestamp(),
        declinedBy: admin.decodedToken.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };

  const batch = db.batch();
  batch.set(businessRef, nowFields, { merge: true });
  batch.set(accountRef, nowFields, { merge: true });
  await batch.commit();

  const nextStatus = action === "accept" ? "approved_pending_payment" : "declined";
  await getAdminAuth().setCustomUserClaims(uid, {
    role: "customer",
    clientId,
    accountStatus: nextStatus,
    termsAccepted: business.termsAccepted === true,
    privacyAccepted: business.privacyAccepted === true,
    termsVersion: text(business.termsVersion),
    privacyVersion: text(business.privacyVersion),
  });

  const updated = await businessRef.get();
  return NextResponse.json({ ok: true, application: payload(clientId, updated.data()) });
}
