import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SCRIPT = `Greet the caller using the configured opening line.
Ask what service they need.
Collect their full name, service address, town or city, preferred contact method, and requested estimate day and time.
Ask for an email address, but allow them to decline.
Repeat a short summary and ask the caller to confirm it.
Only after confirmation, save the qualified lead.
Answer business questions only from the configured business information.`;

function text(value) {
  return trimmedText(value);
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function normalizePhone(value) {
  const digits = text(value).replace(/^tel:/i, "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function servicesObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value)
      .map(([name, description]) => [text(name).toLowerCase(), text(description)])
      .filter(([name, description]) => name && description));
  }
  return Object.fromEntries(list(value).map((line) => {
    const [name, ...rest] = line.split("|");
    const cleanName = text(name).toLowerCase();
    return [cleanName, text(rest.join("|")) || `${text(name)}.`];
  }).filter(([name]) => name));
}

function servicesText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.entries(value).map(([name, description]) => `${name} | ${description}`).join("\n");
}

function numberInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function profilePayload(clientId, business, connection, settings) {
  return {
    clientId,
    businessName: text(settings.businessName || business.businessName || connection.businessName || clientId),
    ownerName: text(settings.ownerName || business.ownerName || connection.ownerName),
    accountEmail: text(business.accountEmail).toLowerCase(),
    connectionKey: text(connection.connectionKey),
    enabled: settings.enabled !== false && connection.enabled !== false && business.status !== "disabled",
    receptionistPhone: text(settings.receptionistPhone || connection.receptionistPhone),
    telnyxConnectionId: text(settings.telnyxConnectionId || connection.telnyxConnectionId),
    receptionistName: text(settings.receptionistName || "Alex"),
    receptionistScript: text(settings.receptionistScript || DEFAULT_SCRIPT),
    aiModel: text(settings.aiModel || "gpt-realtime"),
    aiVoice: text(settings.aiVoice || "alloy"),
    aiSpeechSpeed: numberInRange(settings.aiSpeechSpeed, 1, 0.25, 1.5),
    aiSilenceMs: Math.round(numberInRange(settings.aiSilenceMs, 900, 300, 3000)),
    businessPhone: text(settings.businessPhone || connection.businessPhone || business.accountPhone),
    businessEmail: text(settings.businessEmail || connection.notificationEmail || business.accountEmail).toLowerCase(),
    businessHours: text(settings.businessHours || "Monday through Friday, 8 AM to 5 PM"),
    timeZone: text(settings.timeZone || "America/New_York"),
    estimateDays: text(settings.estimateDays || "Monday through Friday"),
    estimateWeekdays: list(settings.estimateWeekdays).join("\n") || "monday\ntuesday\nwednesday\nthursday\nfriday",
    earliestEstimateStart: text(settings.earliestEstimateStart || "9:00 AM"),
    latestEstimateStart: text(settings.latestEstimateStart || "4:30 PM"),
    businessBase: text(settings.businessBase),
    serviceAreas: list(settings.serviceAreas).join("\n"),
    services: servicesText(settings.services),
    about: list(settings.about).join("\n"),
    openingLine: text(settings.openingLine || "Hi, this is {{receptionist_name}} with {{business_name}}. How can I help you today?"),
    closingLine: text(settings.closingLine || "Thanks for calling {{business_name}}. Goodbye."),
    businessInfo: text(settings.businessInfo),
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
  const connections = new Map(connectionSnapshot.docs.map((document) => [document.id, document.data()]));
  const businesses = businessSnapshot.docs
    .map((document) => ({ clientId: document.id, business: document.data() }))
    .filter(({ business }) => ["active", "approved_pending_payment", "disabled"].includes(text(business.status || "active")));

  const settingSnapshots = businesses.length
    ? await db.getAll(...businesses.map(({ clientId }) => db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist")))
    : [];

  const profiles = businesses.map(({ clientId, business }, index) => profilePayload(
    clientId,
    business,
    connections.get(clientId) || {},
    settingSnapshots[index]?.exists ? settingSnapshots[index].data() : {}
  )).sort((a, b) => a.businessName.localeCompare(b.businessName));

  return NextResponse.json({ profiles });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const body = await request.json();
  const clientId = normalizeClientId(body.clientId);
  if (!clientId) return NextResponse.json({ error: "Choose a client profile." }, { status: 400 });

  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(clientId);
  const connectionRef = db.collection("connections").doc(clientId);
  const settingsRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist");
  const [businessSnapshot, connectionSnapshot] = await Promise.all([businessRef.get(), connectionRef.get()]);
  if (!businessSnapshot.exists) return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });

  const business = businessSnapshot.data();
  const connection = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const connectionKey = text(connection.connectionKey);
  if (!connectionKey) return NextResponse.json({ error: "Generate the client connection key before enabling the receptionist." }, { status: 400 });

  const receptionistPhone = text(body.receptionistPhone);
  const receptionistPhoneNormalized = normalizePhone(receptionistPhone);
  const telnyxConnectionId = text(body.telnyxConnectionId);
  const receptionistScript = text(body.receptionistScript);
  const services = servicesObject(body.services);
  const estimateWeekdays = list(body.estimateWeekdays).map((day) => day.toLowerCase());
  const timeZone = text(body.timeZone || "America/New_York");

  if (!receptionistPhoneNormalized) return NextResponse.json({ error: "Enter the Telnyx phone number for this receptionist." }, { status: 400 });
  if (!telnyxConnectionId) return NextResponse.json({ error: "Enter the Telnyx connection ID." }, { status: 400 });
  if (!receptionistScript) return NextResponse.json({ error: "Enter the receptionist script." }, { status: 400 });
  if (!Object.keys(services).length) return NextResponse.json({ error: "Enter at least one service using Service | Description." }, { status: 400 });
  if (!estimateWeekdays.length) return NextResponse.json({ error: "Enter at least one estimate weekday." }, { status: 400 });
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    return NextResponse.json({ error: "Enter a valid IANA time zone, such as America/New_York." }, { status: 400 });
  }

  const duplicate = await db.collection("connections").where("receptionistPhoneNormalized", "==", receptionistPhoneNormalized).limit(2).get();
  if (duplicate.docs.some((document) => document.id !== clientId)) {
    return NextResponse.json({ error: "That receptionist phone number is already assigned to another client." }, { status: 409 });
  }

  const settings = {
    clientId,
    enabled: body.enabled !== false,
    businessName: text(body.businessName || business.businessName || clientId),
    ownerName: text(body.ownerName || business.ownerName),
    receptionistPhone,
    receptionistPhoneNormalized,
    telnyxConnectionId,
    receptionistName: text(body.receptionistName || "Alex"),
    receptionistScript,
    aiModel: text(body.aiModel || "gpt-realtime"),
    aiVoice: text(body.aiVoice || "alloy"),
    aiSpeechSpeed: numberInRange(body.aiSpeechSpeed, 1, 0.25, 1.5),
    aiSilenceMs: Math.round(numberInRange(body.aiSilenceMs, 900, 300, 3000)),
    businessPhone: text(body.businessPhone || connection.businessPhone || business.accountPhone),
    businessEmail: text(body.businessEmail || connection.notificationEmail || business.accountEmail).toLowerCase(),
    businessHours: text(body.businessHours),
    timeZone,
    estimateDays: text(body.estimateDays),
    estimateWeekdays,
    earliestEstimateStart: text(body.earliestEstimateStart),
    latestEstimateStart: text(body.latestEstimateStart),
    businessBase: text(body.businessBase),
    serviceAreas: list(body.serviceAreas),
    services,
    about: list(body.about),
    openingLine: text(body.openingLine),
    closingLine: text(body.closingLine),
    businessInfo: text(body.businessInfo),
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(settingsRef, settings, { merge: true });
  batch.set(connectionRef, {
    receptionistEnabled: settings.enabled,
    receptionistPhone,
    receptionistPhoneNormalized,
    telnyxConnectionId,
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return NextResponse.json({
    profile: profilePayload(clientId, business, { ...connection, ...settings, connectionKey }, settings),
  });
}

export async function DELETE(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const body = await request.json();
  const clientId = normalizeClientId(body.clientId);
  if (!clientId) return NextResponse.json({ error: "Choose a client profile." }, { status: 400 });

  const db = getAdminDb();
  const batch = db.batch();
  batch.delete(db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist"));
  batch.set(db.collection("connections").doc(clientId), {
    receptionistEnabled: FieldValue.delete(),
    receptionistPhone: FieldValue.delete(),
    receptionistPhoneNormalized: FieldValue.delete(),
    telnyxConnectionId: FieldValue.delete(),
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true });
}
