import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { sendSignupText } from "../../../lib/accountVerification";
import { getAdminDb } from "../../../lib/firebase-admin";
import { accountPhoneRegistryId, normalizeSignupPhone } from "../../../lib/signupAvailability";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function localPhoneDigits(value) {
  const digits = normalizeSignupPhone(value).replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
function areaCode(value) { const digits = localPhoneDigits(value); return digits.length === 10 ? digits.slice(0, 3) : ""; }
function applicationPayload(clientId, data) {
  return {
    clientId,
    uid: text(data.uid || data.ownerUid),
    businessName: text(data.businessName || clientId),
    accountEmail: text(data.accountEmail).toLowerCase(),
    accountPhone: text(data.accountPhone),
    accountPhoneNormalized: normalizeSignupPhone(data.accountPhoneNormalized || data.accountPhone),
    requestedAreaCode: areaCode(data.accountPhoneNormalized || data.accountPhone),
    status: "needs_number",
    numberAssignmentStatus: text(data.numberAssignmentStatus || "needed"),
    submittedAt: iso(data.submittedForNumberAt || data.activatedAt || data.createdAt),
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  const snapshot = await getAdminDb().collection("businesses").get();
  const applications = snapshot.docs
    .filter((document) => document.data().status === "active" && document.data().numberAssignmentStatus === "needed")
    .map((document) => applicationPayload(document.id, document.data()))
    .sort((left, right) => String(left.submittedAt).localeCompare(String(right.submittedAt)));
  return NextResponse.json({ applications, numberAssignments: applications });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = normalizeClientId(body.clientId);
    const receptionistPhone = text(body.receptionistPhone);
    const receptionistPhoneNormalized = normalizeSignupPhone(receptionistPhone);
    if (!clientId) return NextResponse.json({ error: "Choose an account that needs a number." }, { status: 400 });
    if (!/^\+1\d{10}$/.test(receptionistPhoneNormalized)) return NextResponse.json({ error: "Enter a valid 10-digit receptionist number." }, { status: 400 });

    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(clientId);
    const businessSnapshot = await businessRef.get();
    if (!businessSnapshot.exists) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
    const business = businessSnapshot.data();
    if (business.status !== "active" || business.numberAssignmentStatus !== "needed") return NextResponse.json({ error: "That account no longer needs a number." }, { status: 409 });
    const ownerAreaCode = areaCode(business.accountPhoneNormalized || business.accountPhone);
    if (!ownerAreaCode || areaCode(receptionistPhoneNormalized) !== ownerAreaCode) return NextResponse.json({ error: `Assign a receptionist number with the same ${ownerAreaCode || "customer"} area code as the owner's phone.` }, { status: 400 });
    const uid = text(business.uid || business.ownerUid);
    if (!uid) return NextResponse.json({ error: "That account is missing its owner." }, { status: 409 });

    const accountRef = db.collection("accounts").doc(uid);
    const clientRef = db.collection("ocmClients").doc(clientId);
    const connectionRef = db.collection("connections").doc(clientId);
    const receptionistRef = clientRef.collection("settings").doc("receptionist");
    const accountSettingsRef = clientRef.collection("settings").doc("account");
    const registryRef = db.collection("connectionPhoneRegistry").doc(accountPhoneRegistryId(receptionistPhoneNormalized));
    const [accountSnapshot, connectionSnapshot, registrySnapshot, duplicateSnapshot] = await Promise.all([
      accountRef.get(), connectionRef.get(), registryRef.get(),
      db.collection("connections").where("receptionistPhoneNormalized", "==", receptionistPhoneNormalized).limit(2).get(),
    ]);
    if (!accountSnapshot.exists) return NextResponse.json({ error: "That account is missing its owner record." }, { status: 409 });
    if ((registrySnapshot.exists && text(registrySnapshot.data().clientId) !== clientId) || duplicateSnapshot.docs.some((document) => document.id !== clientId)) return NextResponse.json({ error: "That receptionist number is already assigned to another account." }, { status: 409 });

    await db.runTransaction(async (transaction) => {
      const [latestBusiness, latestRegistry] = await Promise.all([transaction.get(businessRef), transaction.get(registryRef)]);
      if (!latestBusiness.exists || latestBusiness.data().status !== "active" || latestBusiness.data().numberAssignmentStatus !== "needed") throw new Error("ASSIGNMENT_CHANGED");
      if (latestRegistry.exists && text(latestRegistry.data().clientId) !== clientId) throw new Error("PHONE_TAKEN");
      transaction.set(registryRef, { clientId, receptionistPhone, receptionistPhoneNormalized, status: "reserved", reservedBy: admin.decodedToken.uid, reservedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    const connectionKey = text(connectionSnapshot.exists ? connectionSnapshot.data().connectionKey : "") || randomBytes(24).toString("hex");
    const assigned = {
      numberAssignmentStatus: "assigned",
      receptionistPhone,
      receptionistPhoneNormalized,
      numberAssignedAt: FieldValue.serverTimestamp(),
      numberAssignedBy: admin.decodedToken.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const batch = db.batch();
    batch.set(accountRef, assigned, { merge: true });
    batch.set(businessRef, assigned, { merge: true });
    batch.set(clientRef, assigned, { merge: true });
    batch.set(connectionRef, {
      clientId,
      businessName: text(business.businessName || clientId),
      ownerName: text(business.ownerName),
      enabled: true,
      businessPhone: text(business.accountPhone),
      notificationPhone: text(business.accountPhone),
      notificationEmail: text(business.accountEmail).toLowerCase(),
      sourceLabel: text(business.businessName || clientId),
      defaultStage: "contactedMe",
      allowStageOverride: false,
      connectionKey,
      receptionistPhone,
      receptionistPhoneNormalized,
      updatedBy: admin.decodedToken.uid,
      createdAt: connectionSnapshot.exists ? connectionSnapshot.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(registryRef, { clientId, receptionistPhone, receptionistPhoneNormalized, status: "assigned", reservedBy: FieldValue.delete(), assignedBy: admin.decodedToken.uid, assignedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(receptionistRef, { enabled: true, receptionistPhone, receptionistPhoneNormalized, updatedBy: admin.decodedToken.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(accountSettingsRef, { ReceptionistPhone: receptionistPhone, NumberAssignmentStatus: "Assigned", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();

    let notificationStatus = "sent";
    try {
      await sendSignupText({ phone: business.accountPhone, message: `Your ARK receptionist number is ready: ${receptionistPhone}. Sign in to ARK Client Center to see it on your dashboard.` });
    } catch (error) {
      notificationStatus = "failed";
      console.error("Unable to send receptionist number assignment text", error);
    }
    return NextResponse.json({ ok: true, application: applicationPayload(clientId, { ...business, ...assigned }), receptionistPhone, notificationStatus });
  } catch (error) {
    console.error("Unable to assign receptionist number", error);
    if (text(error?.message) === "PHONE_TAKEN") return NextResponse.json({ error: "That receptionist number is already assigned to another account." }, { status: 409 });
    if (text(error?.message) === "ASSIGNMENT_CHANGED") return NextResponse.json({ error: "That account no longer needs a number." }, { status: 409 });
    return NextResponse.json({ error: "The receptionist number could not be assigned right now." }, { status: 500 });
  }
}
