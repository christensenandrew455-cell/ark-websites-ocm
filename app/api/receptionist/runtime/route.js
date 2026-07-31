import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const ALLOWED_VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]);
const SIGNATURE_MAX_AGE_SECONDS = 300;

function text(value) {
  return String(value || "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function normalizePhone(value) {
  const raw = text(value).replace(/^tel:/i, "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function servicesObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([name, description]) => {
    const cleanName = text(name).toLowerCase();
    return [cleanName, text(description) || cleanName];
  }).filter(([name]) => name));
}

function numberInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function telnyxSignatureMatches(request, rawBody) {
  const configuredKey = text(process.env.TELNYX_PUBLIC_KEY);
  const signature = text(request.headers.get("telnyx-signature-ed25519"));
  const timestamp = text(request.headers.get("telnyx-timestamp"));
  if (!configuredKey || !signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_MAX_AGE_SECONDS) return false;

  try {
    const key = configuredKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(configuredKey.replaceAll("\\n", "\n"))
      : createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(configuredKey, "base64"),
          ]),
          format: "der",
          type: "spki",
        });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"));
  } catch (error) {
    console.error("Unable to verify Telnyx voice webhook signature", error);
    return false;
  }
}

function calledPhoneFromEvent(body) {
  const event = body?.data || body;
  const payload = event?.payload || body?.payload || body;
  const destination = Array.isArray(payload?.to) ? payload.to[0] : payload?.to;
  const value = destination?.phone_number
    || destination?.number
    || destination
    || payload?.called_number
    || payload?.destination
    || body?.to;
  return normalizePhone(value);
}

async function findConnection(db, calledPhone) {
  if (!calledPhone) return null;
  const normalized = await db.collection("connections")
    .where("receptionistPhoneNormalized", "==", calledPhone)
    .limit(1)
    .get();
  if (!normalized.empty) return normalized.docs[0];

  const raw = await db.collection("connections")
    .where("receptionistPhone", "==", calledPhone)
    .limit(1)
    .get();
  return raw.empty ? null : raw.docs[0];
}

function buildProfile(clientId, business, account, settings, connection) {
  const serviceAreas = list(settings.serviceAreas);
  const services = servicesObject(settings.services);
  const businessBase = text(settings.businessBase) || serviceAreas[0] || "the local service area";
  const normalizedServiceAreas = serviceAreas.length ? serviceAreas : [businessBase];
  const requestedVoice = text(settings.aiVoice);

  return {
    clientId,
    businessName: text(settings.businessName || account.BusinessName || business.businessName || clientId),
    receptionistName: text(settings.receptionistName || "Alex"),
    ownerName: text(settings.ownerName || account.OwnerName || business.ownerName),
    businessPhone: text(settings.businessPhone || account.AccountPhone || business.accountPhone || connection.businessPhone),
    businessEmail: text(settings.businessEmail || account.AccountEmail || business.accountEmail || connection.notificationEmail).toLowerCase(),
    businessHours: text(settings.businessHours || "Monday through Friday, 9:00 AM to 5:00 PM"),
    timeZone: text(settings.timeZone || "America/New_York"),
    estimateDays: text(settings.estimateDays || "Monday through Friday"),
    estimateWeekdays: list(settings.estimateWeekdays).length
      ? list(settings.estimateWeekdays).map((day) => day.toLowerCase())
      : DEFAULT_WEEKDAYS,
    earliestEstimateStart: text(settings.earliestEstimateStart || "9:00 AM"),
    latestEstimateStart: text(settings.latestEstimateStart || "4:30 PM"),
    businessBase,
    serviceAreas: normalizedServiceAreas,
    services,
    about: list(settings.about),
    extraInformation: text(settings.extraInformation),
    aiVoice: ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : "alloy",
    aiSpeechSpeed: numberInRange(settings.aiSpeechSpeed, 0.94, 0.25, 1.5),
    aiSilenceMs: Math.round(numberInRange(settings.aiSilenceMs, 1200, 300, 3000)),
  };
}

function validateProfile(profile) {
  if (!profile.businessName) return "The matched account has no business name.";
  if (!profile.ownerName) return "The matched account has no owner name.";
  if (!profile.businessPhone) return "The matched account has no business phone number.";
  if (!profile.businessEmail) return "The matched account has no business email.";
  if (!Object.keys(profile.services).length) return "The matched account has no receptionist services configured.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: profile.timeZone }).format();
  } catch {
    return "The matched account has an invalid time zone.";
  }
  return "";
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    if (!telnyxSignatureMatches(request, rawBody)) {
      return NextResponse.json({ ok: false, error: "Invalid or expired Telnyx signature." }, { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: "The Telnyx event body is not valid JSON." }, { status: 400 });
    }

    const eventType = text(body?.data?.event_type || body?.event_type);
    if (!eventType.startsWith("call.")) {
      return NextResponse.json({ ok: false, error: "Only Telnyx call events can load receptionist settings." }, { status: 400 });
    }

    const calledPhone = calledPhoneFromEvent(body);
    if (!calledPhone) {
      return NextResponse.json({ ok: false, error: "The called phone number was missing from the Telnyx event." }, { status: 400 });
    }

    const db = getAdminDb();
    const connectionSnapshot = await findConnection(db, calledPhone);
    if (!connectionSnapshot) {
      return NextResponse.json({ ok: false, error: "No ARK account is connected to that phone number." }, { status: 404 });
    }

    const clientId = connectionSnapshot.id;
    const connection = connectionSnapshot.data();
    const [businessSnapshot, accountSnapshot, settingsSnapshot] = await Promise.all([
      db.collection("businesses").doc(clientId).get(),
      db.collection("ocmClients").doc(clientId).collection("settings").doc("account").get(),
      db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist").get(),
    ]);

    if (!businessSnapshot.exists || businessSnapshot.data().status !== "active") {
      return NextResponse.json({ ok: false, error: "The connected business account is not active." }, { status: 404 });
    }
    if (connection.enabled === false || connection.receptionistEnabled === false) {
      return NextResponse.json({ ok: false, error: "The connected receptionist is disabled." }, { status: 403 });
    }
    if (!settingsSnapshot.exists) {
      return NextResponse.json({ ok: false, error: "The business has not completed AI receptionist setup." }, { status: 409 });
    }

    const settings = settingsSnapshot.data();
    if (settings.enabled === false) {
      return NextResponse.json({ ok: false, error: "The business has turned off its AI receptionist." }, { status: 403 });
    }

    const profile = buildProfile(
      clientId,
      businessSnapshot.data(),
      accountSnapshot.exists ? accountSnapshot.data() : {},
      settings,
      connection
    );
    const profileError = validateProfile(profile);
    if (profileError) {
      return NextResponse.json({ ok: false, error: profileError }, { status: 409 });
    }

    const connectionKey = text(connection.connectionKey);
    if (!connectionKey) {
      return NextResponse.json({ ok: false, error: "The matched account is missing its private intake connection." }, { status: 409 });
    }

    const origin = new URL(request.url).origin;
    const intakeUrl = new URL("/api/intake", origin);
    intakeUrl.searchParams.set("clientId", clientId);
    intakeUrl.searchParams.set("key", connectionKey);
    intakeUrl.searchParams.set("source", `${clientId}-receptionist`);

    const usageUrl = new URL("/api/receptionist/call-usage", origin);
    usageUrl.searchParams.set("clientId", clientId);
    usageUrl.searchParams.set("key", connectionKey);

    return NextResponse.json({
      ok: true,
      clientId,
      calledPhone,
      profile,
      intakeUrl: intakeUrl.toString(),
      usageUrl: usageUrl.toString(),
    });
  } catch (error) {
    console.error("Unable to load receptionist runtime settings", error);
    return NextResponse.json({ ok: false, error: "Could not load receptionist settings for that phone number." }, { status: 500 });
  }
}
