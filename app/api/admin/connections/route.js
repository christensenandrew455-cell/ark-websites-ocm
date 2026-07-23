import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { publicBillingStatus } from "../../../lib/billingDelinquency";
import { getAdminDb } from "../../../lib/firebase-admin";
import { normalizeClientId, toIsoString, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectionPayload(clientId, business, data) {
  return {
    clientId,
    businessName: trimmedText(business.businessName || data.businessName || clientId),
    ownerName: trimmedText(data.ownerName || business.ownerName),
    accountEmail: trimmedText(business.accountEmail).toLowerCase(),
    status: trimmedText(business.status || "active"),
    disabledAt: toIsoString(business.disabledAt || data.disabledAt),
    enabled: data.enabled !== false,
    businessPhone: trimmedText(data.businessPhone || business.accountPhone),
    notificationPhone: trimmedText(data.notificationPhone || data.businessPhone || business.accountPhone),
    notificationEmail: trimmedText(data.notificationEmail || business.accountEmail).toLowerCase(),
    sourceLabel: trimmedText(data.sourceLabel || business.businessName || clientId),
    connectionKey: trimmedText(data.connectionKey),
    termsAccepted: business.termsAccepted === true,
    privacyAccepted: business.privacyAccepted === true,
    termsVersion: trimmedText(business.termsVersion),
    privacyVersion: trimmedText(business.privacyVersion),
    legalAcceptedAt: toIsoString(business.legalAcceptedAt),
    legalAcceptedBy: trimmedText(business.legalAcceptedBy || business.accountEmail).toLowerCase(),
    legalAcceptanceSource: trimmedText(business.legalAcceptanceSource),
    billing: publicBillingStatus(business),
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const db = getAdminDb();
  const [businessSnapshot, connectionSnapshot] = await Promise.all([
    db.collection("businesses").get(),
    db.collection("connections").get(),
  ]);

  const adminUid = trimmedText(admin.decodedToken.uid);
  const adminEmail = trimmedText(admin.decodedToken.email).toLowerCase();
  const connections = new Map(connectionSnapshot.docs.map((document) => [document.id, document.data()]));
  const businesses = businessSnapshot.docs
    .map((document) => ({ clientId: document.id, business: document.data() }))
    .filter(({ business }) => trimmedText(business.uid) !== adminUid)
    .filter(({ business }) => !adminEmail || trimmedText(business.accountEmail).toLowerCase() !== adminEmail)
    .map(({ clientId, business }) => connectionPayload(clientId, business, connections.get(clientId) || {}))
    .filter((business) => business.businessName && ["active", "disabled", "approved_pending_payment"].includes(business.status))
    .sort((a, b) => a.businessName.localeCompare(b.businessName));

  return NextResponse.json({ businesses });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const body = await request.json();
  const clientId = normalizeClientId(body.clientId);
  if (!clientId) return NextResponse.json({ error: "Choose a business account." }, { status: 400 });

  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(clientId);
  const connectionRef = db.collection("connections").doc(clientId);
  const [businessSnapshot, connectionSnapshot] = await Promise.all([
    businessRef.get(),
    connectionRef.get(),
  ]);

  if (!businessSnapshot.exists) {
    return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  }

  const business = businessSnapshot.data();
  const current = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const connectionKey = body.regenerateKey === true || !trimmedText(current.connectionKey)
    ? randomBytes(24).toString("hex")
    : trimmedText(current.connectionKey);
  const notificationEmail = trimmedText(body.notificationEmail || business.accountEmail).toLowerCase();

  if (notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
    return NextResponse.json({ error: "Enter a valid lead notification email." }, { status: 400 });
  }

  const data = {
    clientId,
    businessName: trimmedText(business.businessName || clientId),
    ownerName: trimmedText(body.ownerName || business.ownerName),
    enabled: body.enabled !== false && business.status !== "disabled",
    businessPhone: trimmedText(body.businessPhone || business.accountPhone),
    notificationPhone: trimmedText(body.notificationPhone || body.businessPhone || business.accountPhone),
    notificationEmail,
    sourceLabel: trimmedText(body.sourceLabel || business.businessName || clientId),
    defaultStage: "contactedMe",
    allowStageOverride: false,
    connectionKey,
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(connectionSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  const batch = db.batch();
  batch.set(connectionRef, {
    ...data,
    receptionistName: FieldValue.delete(),
    websiteUrl: FieldValue.delete(),
    businessHours: FieldValue.delete(),
    estimateDays: FieldValue.delete(),
    earliestEstimateStart: FieldValue.delete(),
    latestEstimateStart: FieldValue.delete(),
    businessBase: FieldValue.delete(),
    serviceAreas: FieldValue.delete(),
    services: FieldValue.delete(),
    about: FieldValue.delete(),
    businessInfo: FieldValue.delete(),
    receptionistInstructions: FieldValue.delete(),
    notes: FieldValue.delete(),
  }, { merge: true });
  batch.set(businessRef, {
    ownerName: data.ownerName,
    accountPhone: data.businessPhone || business.accountPhone || "",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), {
    BusinessName: data.businessName,
    OwnerName: data.ownerName,
    AccountEmail: trimmedText(business.accountEmail).toLowerCase(),
    AccountPhone: data.businessPhone,
    NotificationEmail: data.notificationEmail,
    NotificationPhone: data.notificationPhone,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.delete(db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist"));
  await batch.commit();

  return NextResponse.json({
    connection: connectionPayload(
      clientId,
      { ...business, ownerName: data.ownerName, accountPhone: data.businessPhone },
      data
    ),
  });
}
