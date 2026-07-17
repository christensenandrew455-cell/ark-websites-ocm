import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function cleanClientId(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function connectionPayload(clientId, business, data) {
  return {
    clientId,
    businessName: text(business.businessName || data.businessName || clientId),
    ownerName: text(data.ownerName || business.ownerName),
    accountEmail: text(business.accountEmail).toLowerCase(),
    status: text(business.status || "active"),
    disabledAt: iso(business.disabledAt || data.disabledAt),
    deletionScheduledFor: iso(business.deletionScheduledFor || data.deletionScheduledFor),
    enabled: data.enabled !== false,
    businessPhone: text(data.businessPhone || business.accountPhone),
    notificationPhone: text(data.notificationPhone || data.businessPhone || business.accountPhone),
    notificationEmail: text(data.notificationEmail || business.accountEmail).toLowerCase(),
    sourceLabel: text(data.sourceLabel || business.businessName || clientId),
    connectionKey: text(data.connectionKey),
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

  const connections = new Map(
    connectionSnapshot.docs.map((document) => [document.id, document.data()])
  );

  const businesses = businessSnapshot.docs
    .map((document) => {
      const business = document.data();
      const connection = connections.get(document.id) || {};
      return connectionPayload(document.id, business, connection);
    })
    .filter((business) => business.businessName)
    .sort((a, b) => a.businessName.localeCompare(b.businessName));

  return NextResponse.json({ businesses });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const body = await request.json();
  const clientId = cleanClientId(body.clientId);
  if (!clientId) {
    return NextResponse.json({ error: "Choose a business account." }, { status: 400 });
  }

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
  const connectionKey = body.regenerateKey === true || !text(current.connectionKey)
    ? randomBytes(24).toString("hex")
    : text(current.connectionKey);
  const notificationEmail = text(body.notificationEmail || business.accountEmail).toLowerCase();

  if (notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
    return NextResponse.json({ error: "Enter a valid lead notification email." }, { status: 400 });
  }

  const data = {
    clientId,
    businessName: text(business.businessName || clientId),
    ownerName: text(body.ownerName || business.ownerName),
    enabled: body.enabled !== false && business.status !== "disabled",
    businessPhone: text(body.businessPhone || business.accountPhone),
    notificationPhone: text(body.notificationPhone || body.businessPhone || business.accountPhone),
    notificationEmail,
    sourceLabel: text(body.sourceLabel || business.businessName || clientId),
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
    AccountEmail: text(business.accountEmail).toLowerCase(),
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
