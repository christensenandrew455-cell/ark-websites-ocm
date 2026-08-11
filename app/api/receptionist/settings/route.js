import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

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
    return Object.fromEntries(Object.entries(value).map(([name, description]) => {
      const cleanName = text(name).toLowerCase();
      return [cleanName, text(description) || cleanName];
    }).filter(([name]) => name));
  }
  return Object.fromEntries(list(value).map((line) => {
    const [name, ...description] = line.split("|");
    const cleanName = text(name).toLowerCase();
    return [cleanName, text(description.join("|")) || cleanName];
  }).filter(([name]) => name));
}

function profilePayload(clientId, business = {}, account = {}, settings = {}, connection = {}, configured = false, onboarding = false) {
  const savedEstimateWeekdays = list(settings.estimateWeekdays).map((day) => day.toLowerCase());
  return {
    configured,
    clientId,
    enabled: settings.enabled !== false,
    receptionistPhone: text(settings.receptionistPhone || connection.receptionistPhone),
    receptionistPhoneNormalized: text(settings.receptionistPhoneNormalized || connection.receptionistPhoneNormalized),
    businessName: text(settings.businessName || account.BusinessName || business.businessName || clientId),
    ownerName: text(settings.ownerName || account.OwnerName || business.ownerName),
    businessPhone: text(settings.businessPhone || account.AccountPhone || business.accountPhone),
    businessEmail: text(settings.businessEmail || account.AccountEmail || business.accountEmail).toLowerCase(),
    businessHours: text(settings.businessHours || (onboarding ? "" : "Monday through Friday, 9:00 AM to 5:00 PM")),
    timeZone: text(settings.timeZone || (onboarding ? "" : "America/New_York")),
    estimateDays: text(settings.estimateDays || (onboarding ? "" : "Monday through Friday")),
    estimateWeekdays: savedEstimateWeekdays.length ? savedEstimateWeekdays : onboarding ? [] : DEFAULT_WEEKDAYS,
    earliestEstimateStart: text(settings.earliestEstimateStart || (onboarding ? "" : "9:00 AM")),
    latestEstimateStart: text(settings.latestEstimateStart || (onboarding ? "" : "4:30 PM")),
    businessBase: text(settings.businessBase),
    serviceAreas: list(settings.serviceAreas),
    services: servicesObject(settings.services),
    extraInformation: text(settings.extraInformation),
  };
}

async function resolveClient(request, body = null) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const isAdmin = user.decodedToken.role === "admin";
  if (!isAdmin && user.decodedToken.role !== "customer") {
    return { response: NextResponse.json({ error: "Only the business owner can change receptionist and business settings." }, { status: 403 }) };
  }
  const requested = body?.clientId || new URL(request.url).searchParams.get("clientId");
  const clientId = normalizeClientId(isAdmin ? requested : user.decodedToken.clientId);
  if (!clientId) return { response: NextResponse.json({ error: isAdmin ? "Choose an account." : "This account has no business assigned." }, { status: 400 }) };
  return { user, isAdmin, clientId };
}

async function loadProfile(db, clientId) {
  const businessRef = db.collection("businesses").doc(clientId);
  const accountSettingsRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("account");
  const settingsRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist");
  const connectionRef = db.collection("connections").doc(clientId);
  const [businessSnapshot, accountSnapshot, settingsSnapshot, connectionSnapshot] = await Promise.all([
    businessRef.get(), accountSettingsRef.get(), settingsRef.get(), connectionRef.get(),
  ]);
  if (!businessSnapshot.exists) return null;
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
  const configured = settingsSnapshot.exists && (settings.businessSetupComplete === true || Boolean(text(settings.businessName) && text(settings.businessEmail) && text(settings.businessPhone) && Object.keys(servicesObject(settings.services)).length));
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
  try { new Intl.DateTimeFormat("en-US", { timeZone: profile.timeZone }).format(); } catch { return "Choose a valid time zone."; }
  return "";
}

async function validateConnectionPhone(db, clientId, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { normalized: "" };
  const duplicate = await db.collection("connections").where("receptionistPhoneNormalized", "==", normalized).limit(2).get();
  if (duplicate.docs.some((document) => document.id !== clientId)) return { error: "That connected phone number is already assigned to another account." };
  return { normalized };
}

async function validateBusinessName(db, clientId, value) {
  const businessNameKey = normalizeClientId(value);
  if (!businessNameKey) return { error: "Enter the business name." };
  const [registrySnapshot, businessSnapshot] = await Promise.all([
    db.collection("businessNameRegistry").doc(businessNameKey).get(),
    db.collection("businesses").doc(businessNameKey).get(),
  ]);
  if (registrySnapshot.exists && normalizeClientId(registrySnapshot.data().clientId) !== clientId) {
    return { error: "That business name is already registered. Choose a different business name." };
  }
  if (businessSnapshot.exists && businessSnapshot.id !== clientId) {
    return { error: "That business name is already registered. Choose a different business name." };
  }
  return { businessNameKey };
}

export async function GET(request) {
  const access = await resolveClient(request);
  if (access.response) return access.response;
  const db = getAdminDb();
  const loaded = await loadProfile(db, access.clientId);
  if (!loaded) return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  const onboarding = new URL(request.url).searchParams.get("onboarding") === "1";
  return NextResponse.json({ profile: profilePayload(access.clientId, loaded.business, loaded.account, loaded.settings, loaded.connection, loaded.configured, onboarding) });
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
    batch.set(loaded.connectionRef, { receptionistEnabled: connected, receptionistPhone: phone, receptionistPhoneNormalized: phoneCheck.normalized, updatedBy: access.user.decodedToken.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(loaded.settingsRef, { receptionistPhone: phone, receptionistPhoneNormalized: phoneCheck.normalized, updatedBy: access.user.decodedToken.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    return NextResponse.json({ profile: profilePayload(access.clientId, loaded.business, loaded.account, { ...loaded.settings, receptionistPhone: phone, receptionistPhoneNormalized: phoneCheck.normalized }, { ...loaded.connection, receptionistPhone: phone, receptionistPhoneNormalized: phoneCheck.normalized }, loaded.configured) });
  }

  const current = profilePayload(access.clientId, loaded.business, loaded.account, loaded.settings, loaded.connection, loaded.configured);
  const profile = {
    ...current,
    businessName: text(body.businessName ?? current.businessName),
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
    extraInformation: text(body.extraInformation ?? current.extraInformation),
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
  const nameCheck = await validateBusinessName(db, access.clientId, profile.businessName);
  if (nameCheck.error) return NextResponse.json({ error: nameCheck.error }, { status: 409 });

  const settingsData = {
    clientId: access.clientId,
    businessSetupComplete: true,
    enabled: profile.enabled,
    receptionistPhone: profile.receptionistPhone,
    receptionistPhoneNormalized: profile.receptionistPhoneNormalized,
    businessName: profile.businessName,
    receptionistName: FieldValue.delete(),
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
    about: FieldValue.delete(),
    extraInformation: profile.extraInformation,
    aiVoice: FieldValue.delete(),
    aiSpeechSpeed: FieldValue.delete(),
    aiSilenceMs: FieldValue.delete(),
    aiModel: FieldValue.delete(),
    openingLine: FieldValue.delete(),
    closingLine: FieldValue.delete(),
    updatedBy: access.user.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(loaded.configured ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  const batch = db.batch();
  batch.set(loaded.settingsRef, settingsData, { merge: true });
  batch.set(loaded.accountSettingsRef, { BusinessName: profile.businessName, OwnerName: profile.ownerName, AccountEmail: profile.businessEmail, AccountPhone: profile.businessPhone, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(loaded.businessRef, { businessName: profile.businessName, businessNameKey: nameCheck.businessNameKey, ownerName: profile.ownerName, accountPhone: profile.businessPhone, businessSetupComplete: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.collection("businessNameRegistry").doc(nameCheck.businessNameKey), { clientId: access.clientId, businessName: profile.businessName, ownerUid: text(loaded.business.ownerUid || loaded.business.uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.collection("ocmClients").doc(access.clientId), { businessName: profile.businessName, businessSetupComplete: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  const customerUid = text(loaded.business.ownerUid || loaded.business.uid);
  if (customerUid) batch.set(db.collection("accounts").doc(customerUid), { businessName: profile.businessName, businessNameKey: nameCheck.businessNameKey, ownerName: profile.ownerName, accountPhone: profile.businessPhone, businessSetupComplete: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (access.isAdmin) batch.set(loaded.connectionRef, { receptionistEnabled: Boolean(profile.receptionistPhoneNormalized) && profile.enabled, receptionistPhone: profile.receptionistPhone, receptionistPhoneNormalized: profile.receptionistPhoneNormalized, updatedBy: access.user.decodedToken.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();

  if (loaded.business.billingPlan === "business") {
    const employees = await loaded.businessRef.collection("employees").get();
    await Promise.all(employees.docs.map((document) => Promise.all([
      document.ref.set({ businessName: profile.businessName, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      db.collection("accounts").doc(document.id).set({ businessName: profile.businessName, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ])));
  }

  return NextResponse.json({ profile: profilePayload(access.clientId, { ...loaded.business, businessName: profile.businessName, ownerName: profile.ownerName, accountPhone: profile.businessPhone }, { ...loaded.account, BusinessName: profile.businessName, OwnerName: profile.ownerName, AccountEmail: profile.businessEmail, AccountPhone: profile.businessPhone }, settingsData, { ...loaded.connection, receptionistPhone: profile.receptionistPhone, receptionistPhoneNormalized: profile.receptionistPhoneNormalized }, true) });
}
