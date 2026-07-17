import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STAGES = new Set(["contactedMe", "preClients", "clients", "postClients"]);

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

function cleanUrl(value) {
  const normalized = text(value);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function appOrigin(request) {
  return text(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

function businessInfoPayload(clientId, business, data) {
  const serviceNames = list(data.services);
  return {
    name: text(business.businessName || data.businessName || clientId),
    receptionist: text(data.receptionistName || "Alex"),
    owner: text(data.ownerName || business.ownerName),
    phone: text(data.businessPhone || business.accountPhone),
    email: text(data.notificationEmail || business.accountEmail).toLowerCase(),
    hours: text(data.businessHours || "Monday through Friday, 8 AM to 5 PM"),
    estimateDays: text(data.estimateDays || "Monday through Friday"),
    earliestEstimateStart: text(data.earliestEstimateStart || "9:00 AM"),
    latestEstimateStart: text(data.latestEstimateStart || "4:30 PM"),
    base: text(data.businessBase),
    serviceAreas: list(data.serviceAreas),
    services: Object.fromEntries(serviceNames.map((service) => [service.toLowerCase(), `${service}.`])),
    about: list(data.about),
    extraInformation: text(data.businessInfo),
    receptionistInstructions: text(data.receptionistInstructions),
  };
}

function connectionPayload(clientId, business, data, request) {
  const origin = appOrigin(request);
  const connectionKey = text(data.connectionKey);
  const ocmWebhookUrl = `${origin}/api/intake`;
  const baseUrl = `${ocmWebhookUrl}?clientId=${encodeURIComponent(clientId)}&key=${encodeURIComponent(connectionKey)}`;
  const info = businessInfoPayload(clientId, business, data);
  const businessInfoJson = JSON.stringify(info);
  const sourceLabel = text(data.sourceLabel || business.businessName || clientId);

  return {
    clientId,
    businessName: text(business.businessName || data.businessName || clientId),
    ownerName: text(data.ownerName || business.ownerName),
    accountEmail: text(business.accountEmail).toLowerCase(),
    accountPhone: text(business.accountPhone),
    receptionistName: info.receptionist,
    enabled: data.enabled !== false,
    websiteUrl: text(data.websiteUrl),
    businessPhone: text(data.businessPhone || business.accountPhone),
    notificationPhone: text(data.notificationPhone || business.accountPhone),
    notificationEmail: text(data.notificationEmail || business.accountEmail).toLowerCase(),
    sourceLabel,
    defaultStage: ALLOWED_STAGES.has(data.defaultStage) ? data.defaultStage : "contactedMe",
    allowStageOverride: data.allowStageOverride === true,
    notes: text(data.notes),
    connectionKey,
    businessHours: info.hours,
    estimateDays: info.estimateDays,
    earliestEstimateStart: info.earliestEstimateStart,
    latestEstimateStart: info.latestEstimateStart,
    businessBase: info.base,
    serviceAreas: info.serviceAreas.join(", "),
    services: Object.keys(info.services).join("\n"),
    about: info.about.join("\n"),
    businessInfo: info.extraInformation,
    receptionistInstructions: info.receptionistInstructions,
    ocmWebhookUrl,
    websiteWebhookUrl: connectionKey ? `${baseUrl}&source=website` : "",
    phoneWebhookUrl: connectionKey ? `${baseUrl}&source=phone` : "",
    businessInfoJson,
    railwayVariables: [
      `OCM_WEBHOOK_URL=${ocmWebhookUrl}`,
      `OCM_CONNECTION_KEY=${connectionKey}`,
      `OCM_CLIENT_ID=${clientId}`,
      `OCM_SOURCE=${sourceLabel}`,
      `BUSINESS_INFO=${businessInfoJson}`,
    ].join("\n"),
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
      return connectionPayload(document.id, business, connection, request);
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

  const websiteUrl = text(body.websiteUrl);
  if (websiteUrl && !cleanUrl(websiteUrl)) {
    return NextResponse.json({ error: "Enter a valid website URL beginning with http:// or https://." }, { status: 400 });
  }

  const defaultStage = ALLOWED_STAGES.has(body.defaultStage) ? body.defaultStage : "contactedMe";
  const data = {
    clientId,
    businessName: text(business.businessName || clientId),
    ownerName: text(body.ownerName || business.ownerName),
    receptionistName: text(body.receptionistName || "Alex"),
    enabled: body.enabled !== false,
    websiteUrl: cleanUrl(websiteUrl),
    businessPhone: text(body.businessPhone || business.accountPhone),
    notificationPhone: text(body.notificationPhone || business.accountPhone),
    notificationEmail: text(body.notificationEmail || business.accountEmail).toLowerCase(),
    sourceLabel: text(body.sourceLabel || business.businessName || clientId),
    defaultStage,
    allowStageOverride: body.allowStageOverride === true,
    notes: text(body.notes),
    connectionKey,
    businessHours: text(body.businessHours),
    estimateDays: text(body.estimateDays),
    earliestEstimateStart: text(body.earliestEstimateStart),
    latestEstimateStart: text(body.latestEstimateStart),
    businessBase: text(body.businessBase),
    serviceAreas: list(body.serviceAreas).join(", "),
    services: list(body.services).join("\n"),
    about: list(body.about).join("\n"),
    businessInfo: text(body.businessInfo),
    receptionistInstructions: text(body.receptionistInstructions),
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(connectionSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  const info = businessInfoPayload(clientId, business, data);
  const batch = db.batch();
  batch.set(connectionRef, data, { merge: true });
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
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist"), {
    ...info,
    sourceLabel: data.sourceLabel,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return NextResponse.json({
    connection: connectionPayload(clientId, { ...business, ownerName: data.ownerName, accountPhone: data.businessPhone }, data, request),
  });
}
