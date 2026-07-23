import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_OPENING = "Hi, this is {{receptionist_name}} with {{business_name}}. Can I set you up with an estimate today?";
const DEFAULT_CLOSING = "{{owner_first_name}} will follow up with you shortly. Thanks for calling {{business_name}}. Goodbye.";
const DEFAULT_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const ALLOWED_VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]);

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
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function servicesObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([name, description]) => {
          const cleanName = text(name).toLowerCase();
          return [cleanName, text(description) || cleanName];
        })
        .filter(([name]) => name)
    );
  }
  return Object.fromEntries(
    list(value)
      .map((line) => {
        const [name, ...description] = line.split("|");
        const cleanName = text(name).toLowerCase();
        return [cleanName, text(description.join("|")) || cleanName];
      })
      .filter(([name]) => name)
  );
}

function numberInRange(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function profilePayload(clientId, business = {}, account = {}, settings = {}, connection = {}, configured = false) {
  return {
    configured,
    clientId,
    enabled: settings.enabled !== false,
    receptionistPhone: text(settings.receptionistPhone || connection.receptionistPhone),
    receptionistPhoneNormalized: text(settings.receptionistPhoneNormalized || connection.receptionistPhoneNormalized),
    businessName: text(settings.businessName || account.BusinessName || business.businessName || clientId),
    receptionistName: text(settings.receptionistName || "Alex"),
    ownerName: text(settings.ownerName || account.OwnerName || business.ownerName),
    businessPhone: text(settings.businessPhone || account.AccountPhone || business.accountPhone),
    businessEmail: text(settings.businessEmail || account.AccountEmail || business.accountEmail).toLowerCase(),
    businessHours: text(settings.businessHours || "Monday through Friday, 9:00 AM to 5:00 PM"),
    timeZone: text(settings.timeZone || "America/New_York"),
    estimateDays: text(settings.estimateDays || "Monday through Friday"),
    estimateWeekdays: list(settings.estimateWeekdays).length ? list(settings.estimateWeekdays).map((day) => day.toLowerCase()) : DEFAULT_WEEKDAYS,
    earliestEstimateStart: text(settings.earliestEstimateStart || "9:00 AM"),
    latestEstimateStart: text(settings.latestEstimateStart || "4:30 PM"),
    businessBase: text(settings.businessBase),
    serviceAreas: list(settings.serviceAreas),
    services: servicesObject(settings.services),
    about: list(settings.about),
    openingLine: text(settings.openingLine || DEFAULT_OPENING),
    closingLine: text(settings.closingLine || DEFAULT_CLOSING),
    extraInformation: text(settings.extraInformation),
    aiModel: "gpt-realtime-mini",
    aiVoice: ALLOWED_VOICES.has(text(settings.aiVoice)) ? text(settings.aiVoice) : "alloy",
    aiSpeechSpeed: numberInRange(settings.aiSpeechSpeed, 0.94, 0.25, 1.5),
    aiSilenceMs: Math.round(numberInRange(settings.aiSilenceMs, 1200, 300, 3000)),
  };
}

async function resolveClient(request, body = null) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const isAdmin = user.decodedToken.role === "admin";
  const requested = body?.clientId || new URL(request.url).searchParams.get("clientId");
  const clientId = normalizeClientId(isAdmin ? requested : user.decodedToken.clientId);
  if (!clientId) {
    return { response: NextResponse.json({ error: isAdmin ? "Choose an account." : "This account has no business assigned." }, { status: 400 }) };
  }
  return { user, isAdmin, clientId };
}

async function loadProfile(db, clientId) {
  const businessRef = db.collection("businesses").doc(clientId);
  const accountSettingsRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("account");
  const settingsRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist");
  const connectionRef = db.collection("connections").doc(clientId);
  const [businessSnapshot, accountSnapshot, settingsSnapshot, connectionSnapshot] = await Promise.all([
    businessRef.get(),
    accountSettingsRef.get(),
    settingsRef.get(),
    connectionRef.get(),
  ]);
  if (!businessSnapshot.exists) return null;
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
  const configured = settingsSnapshot.exists && (
    settings.businessSetupComplete === true
    || Boolean(text(settings.businessName) && text(settings.businessEmail) && text(settings.businessPhone) && Object.keys(servicesObject(settings.services)).length)
  );
  return {
    businessRef,
    accountSettingsRef,
    settingsRef,
    connectionRef,
    business: businessSnapshot.data(),
    account: accountSnapshot.exists ? accountSnapshot.data() : {},
    settings,
    connection: connectionSnapshot.exists ? connectionSnapshot.data() : {},
    configured,
  };
}

function validateProfile(profile) {
  if (!profile.businessName) return "Enter the business name.";
  if (!profile.ownerName) return "Enter the owner name.";
  if (!profile.businessEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.businessEmail)) return "Enter a valid business email.";
  if (!profile.businessPhone) return "Enter the business phone number.";
  if (!profile.estimateWeekdays.length) return "Select at least one day available for estimates.";
  if (!Object.keys(profile.services).length) return "Add at least one service.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: profile.timeZone }).format();
  } catch {
    return "Choose a valid time zone.";
  }
  return "";
}

async function validateConnectionPhone(db, clientId, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { normalized: "" };
  const duplicate = await db.collection("connections").where("receptionistPhoneNormalized", "==", normalized).limit(2).get();
  if (duplicate.docs.some((document) => document.id !== clientId)) return { error: "That connected phone number is already assigned to another account." };
  return { normalized };
}

export async function GET(request) {
  const access = await resolveClient(request);
  if (access.response) return access.response;
  const db = getAdminDb();
  const loaded = await loadProfile(db, access.clientId);
  if (!loaded) return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  return NextResponse.json({ profile: profilePayload(access.clientId, loaded.business, loaded.account, loaded.settings, loaded.connection, loaded.configured) });
}

export async function POST(request) {
  const body = await request.json();
  const access = await resolveClient(request, body);
  if (access.response) return access.response;

  const db = getAdminDb();
  const loaded = await loadProfile(db, access.clientId);
  if (!loaded) return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });

  if (access.isAdmin && body.connectionOnly === true) {
    const phone = text(body.receptionistPhone);
    const phoneCheck = await validateConnectionPhone(db, access.clientId, phone);
    if (phoneCheck.error) return NextResponse.json({ error: phoneCheck.error }, { status: 400 });
    const connected = Boolean(phoneCheck.normalized);
    const batch = db.batch();
    batch.set(loaded.connectionRef, {
      receptionistEnabled: connected,
      receptionistPhone: phone,
      receptionistPhoneNormalized: phoneCheck.normalized,
      updatedBy: access.user.decodedToken.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(loaded.settingsRef, {
      receptionistPhone: phone,
      receptionistPhoneNormalized: phoneCheck.normalized,
      updatedBy: access.user.decodedToken.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return NextResponse.json({
      profile: profilePayload(
        access.clientId,
        loaded.business,
        loaded.account,
        { ...loaded.settings, receptionistPhone: phone, receptionistPhoneNormalized: phoneCheck.normalized },
        { ...loaded.connection, receptionistPhone: phone, receptionistPhoneNormalized: phoneCheck.normalized },
        loaded.configured,
      ),
    });
  }

  const current = profilePayload(access.clientId, loaded.business, loaded.account, loaded.settings, loaded.connection, loaded.configured);
  const requestedVoice = text(body.aiVoice ?? current.aiVoice);
  const profile = {
    ...current,
    businessName: text(body.businessName ?? current.businessName),
    receptionistName: text(body.receptionistName ?? current.receptionistName) || "Alex",
    ownerName: text(body.ownerName ?? current.ownerName),
    businessPhone: text(body.businessPhone ?? current.businessPhone),
    businessEmail: text(body.businessEmail ?? current.businessEmail).toLowerCase(),
    businessHours: text(body.businessHours ?? current.businessHours),
    timeZone: text(body.timeZone ?? current.timeZone) || "America/New_York",
    estimateDays: text(body.estimateDays ?? current.estimateDays),
    estimateWeekdays: list(body.estimateWeekdays ?? current.estimateWeekdays).map((day) => day.toLowerCase()),
    earliestEstimateStart: text(body.earliestEstimateStart ?? current.earliestEstimateStart),
    latestEstimateStart: text(body.latestEstimateStart ?? current.latestEstimateStart),
    businessBase: text(body.businessBase ?? current.businessBase),
    serviceAreas: list(body.serviceAreas ?? current.serviceAreas),
    services: servicesObject(body.services ?? current.services),
    about: list(body.about ?? current.about),
    openingLine: text(body.openingLine ?? current.openingLine) || DEFAULT_OPENING,
    closingLine: text(body.closingLine ?? current.closingLine) || DEFAULT_CLOSING,
    extraInformation: text(body.extraInformation ?? current.extraInformation),
    aiVoice: ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : current.aiVoice,
    aiSpeechSpeed: numberInRange(body.aiSpeechSpeed, current.aiSpeechSpeed, 0.25, 1.5),
    aiSilenceMs: Math.round(numberInRange(body.aiSilenceMs, current.aiSilenceMs, 300, 3000)),
  };

  if (access.isAdmin) {
    profile.enabled = body.enabled !== false;
    profile.receptionistPhone = text(body.receptionistPhone ?? current.receptionistPhone);
    const phoneCheck = await validateConnectionPhone(db, access.clientId, profile.receptionistPhone);
    if (phoneCheck.error) return NextResponse.json({ error: phoneCheck.error }, { status: 400 });
    profile.receptionistPhoneNormalized = phoneCheck.normalized;
  }

  const validationError = validateProfile(profile);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const settingsData = {
    clientId: access.clientId,
    businessSetupComplete: true,
    enabled: profile.enabled,
    receptionistPhone: profile.receptionistPhone,
    receptionistPhoneNormalized: profile.receptionistPhoneNormalized,
    businessName: profile.businessName,
    receptionistName: profile.receptionistName,
    ownerName: profile.ownerName,
    businessPhone: profile.businessPhone,
    businessEmail: profile.businessEmail,
    businessHours: profile.businessHours,
    timeZone: profile.timeZone,
    estimateDays: profile.estimateDays,
    estimateWeekdays: profile.estimateWeekdays,
    earliestEstimateStart: profile.earliestEstimateStart,
    latestEstimateStart: profile.latestEstimateStart,
    businessBase: profile.businessBase,
    serviceAreas: profile.serviceAreas,
    services: profile.services,
    about: profile.about,
    openingLine: profile.openingLine,
    closingLine: profile.closingLine,
    extraInformation: profile.extraInformation,
    aiVoice: profile.aiVoice,
    aiSpeechSpeed: profile.aiSpeechSpeed,
    aiSilenceMs: profile.aiSilenceMs,
    updatedBy: access.user.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(loaded.configured ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  const batch = db.batch();
  batch.set(loaded.settingsRef, settingsData, { merge: true });
  batch.set(loaded.accountSettingsRef, {
    BusinessName: profile.businessName,
    OwnerName: profile.ownerName,
    AccountEmail: profile.businessEmail,
    AccountPhone: profile.businessPhone,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(loaded.businessRef, {
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    accountPhone: profile.businessPhone,
    businessSetupComplete: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection("ocmClients").doc(access.clientId), {
    businessName: profile.businessName,
    businessSetupComplete: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const customerUid = text(loaded.business.uid);
  if (customerUid) {
    batch.set(db.collection("accounts").doc(customerUid), {
      businessName: profile.businessName,
      ownerName: profile.ownerName,
      accountPhone: profile.businessPhone,
      businessSetupComplete: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  if (access.isAdmin) {
    batch.set(loaded.connectionRef, {
      receptionistEnabled: Boolean(profile.receptionistPhoneNormalized) && profile.enabled,
      receptionistPhone: profile.receptionistPhone,
      receptionistPhoneNormalized: profile.receptionistPhoneNormalized,
      updatedBy: access.user.decodedToken.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
  return NextResponse.json({
    profile: profilePayload(
      access.clientId,
      { ...loaded.business, businessName: profile.businessName, ownerName: profile.ownerName, accountPhone: profile.businessPhone },
      { ...loaded.account, BusinessName: profile.businessName, OwnerName: profile.ownerName, AccountEmail: profile.businessEmail, AccountPhone: profile.businessPhone },
      settingsData,
      { ...loaded.connection, receptionistPhone: profile.receptionistPhone, receptionistPhoneNormalized: profile.receptionistPhoneNormalized },
      true,
    ),
  });
}
