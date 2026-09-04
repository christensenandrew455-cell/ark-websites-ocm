import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../lib/accountRoles";
import { businessRootFieldDeletes, readAccountSections } from "../../../lib/accountSections";
import { canonicalBusinessType, isSupportedBusinessType } from "../../../lib/businessCatalog";
import { normalizeEmergencyServiceSettings, normalizeRegularServiceSettings, REGULAR_SERVICE_WEEKDAYS } from "../../../lib/emergencyService";
import { getAdminDb } from "../../../lib/firebase-admin";
import { businessInformationText, normalizeBusinessInformation } from "../../../lib/receptionistBusinessInformation";
import { normalizeServiceAreas, serviceAreaValidationError } from "../../../lib/serviceAreas";
import { normalizeSignupPhone, signupPhoneVariants } from "../../../lib/signupAvailability";
import { requireUser } from "../../../lib/userRequest";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return trimmedText(value); }
function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
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

function profilePayload(clientId, account = {}) {
  const businessInformation = normalizeBusinessInformation(account.businessInformation);
  const services = servicesObject(account.services);
  const businessName = text(account.businessName || clientId);
  const businessEmail = text(account.businessEmail || account.accountEmail).toLowerCase();
  const businessPhone = text(account.businessPhone || account.accountPhone);
  const configured = account.businessSetupComplete === true
    || Boolean(businessName && businessEmail && businessPhone && Object.keys(services).length);
  const savedEstimateWeekdays = list(account.estimateWeekdays).map((day) => day.toLowerCase());
  const regularService = {
    ...normalizeRegularServiceSettings(account),
    regularServiceEveryDay: typeof account.regularServiceEveryDay === "boolean"
      ? account.regularServiceEveryDay
      : REGULAR_SERVICE_WEEKDAYS.every((day) => savedEstimateWeekdays.includes(day)),
  };
  return {
    configured,
    clientId,
    enabled: account.enabled !== false,
    receptionistPhone: text(account.receptionistPhone),
    receptionistPhoneNormalized: text(account.receptionistPhoneNormalized),
    businessName,
    ownerName: text(account.ownerName),
    businessPhone,
    businessEmail,
    timeZone: text(account.timeZone || "America/New_York"),
    estimateWeekdays: regularService.regularServiceEveryDay ? REGULAR_SERVICE_WEEKDAYS : savedEstimateWeekdays,
    earliestEstimateStart: regularService.regularService24Hours ? "" : text(account.earliestEstimateStart),
    latestEstimateStart: regularService.regularService24Hours ? "" : text(account.latestEstimateStart),
    ...regularService,
    ...normalizeEmergencyServiceSettings(account),
    businessType: canonicalBusinessType(account.businessType || account.businessBase) || text(account.businessType || account.businessBase),
    serviceAreas: normalizeServiceAreas(account.serviceAreas),
    services,
    businessInformation,
    extraInformation: businessInformationText(businessInformation),
  };
}

function clockMinutes(value) {
  const match = text(value).toUpperCase().match(/^\s*(1[0-2]|[1-9])(?::([0-5]\d))?\s*(AM|PM)\s*$/);
  if (!match) return null;
  const hour = Number(match[1]) % 12;
  return (hour + (match[3] === "PM" ? 12 : 0)) * 60 + Number(match[2] || 0);
}
function validateEstimateSchedule(profile) {
  if (profile.regularService24Hours === true) return "";
  if (profile.earliestEstimateStart && clockMinutes(profile.earliestEstimateStart) === null) return "Choose a valid earliest regular time.";
  if (profile.latestEstimateStart && clockMinutes(profile.latestEstimateStart) === null) return "Choose a valid latest regular time.";
  return "";
}

async function resolveClient(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  if (!isStandardRole(user.decodedToken.role)) return { response: NextResponse.json({ error: "Only the business owner can change receptionist and business settings." }, { status: 403 }) };
  const clientId = normalizeClientId(user.decodedToken.clientId);
  if (!clientId) return { response: NextResponse.json({ error: "This account has no business assigned." }, { status: 400 }) };
  return { user, clientId };
}
async function loadProfile(db, clientId) {
  const ref = db.collection("accounts").doc(clientId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const sections = await readAccountSections(snapshot);
  return { ref, businessRef: sections.businessRef, account: sections.combined };
}
function validateProfile(profile, { allowEmptyServices = false } = {}) {
  if (!profile.businessName) return "Enter the business name.";
  if (!profile.ownerName) return "Enter the owner name.";
  if (!profile.businessEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.businessEmail)) return "Enter a valid business email.";
  if (!profile.businessPhone) return "Enter the business phone number.";
  if (!profile.businessType) return "Enter the type of business.";
  if (!isSupportedBusinessType(profile.businessType)) return "Choose a business type from the list.";
  const serviceAreaError = serviceAreaValidationError(profile.serviceAreas);
  if (serviceAreaError) return serviceAreaError;
  if (!allowEmptyServices && !Object.keys(profile.services).length) return "Add at least one service.";
  try { new Intl.DateTimeFormat("en-US", { timeZone: profile.timeZone }).format(); } catch { return "Choose a valid time zone."; }
  return validateEstimateSchedule(profile);
}
async function validateBusinessName(db, clientId, value) {
  const businessNameKey = normalizeClientId(value);
  if (!businessNameKey) return { error: "Enter the business name." };
  const [matches, direct] = await Promise.all([
    db.collection("accounts").where("businessNameKey", "==", businessNameKey).limit(2).get(),
    db.collection("accounts").doc(businessNameKey).get(),
  ]);
  if (matches.docs.some((document) => document.id !== clientId) || (direct.exists && direct.id !== clientId)) return { error: "That business name is already registered. Choose a different business name." };
  return { businessNameKey };
}
async function validateBusinessPhone(db, clientId, phone) {
  const normalized = normalizeSignupPhone(phone);
  if (!/^\+1\d{10}$/.test(normalized)) return { error: "Enter a valid 10-digit business phone number." };
  const accountPhoneVariants = signupPhoneVariants(normalized);
  const [businessMatches, accountMatches] = await Promise.all([
    db.collection("accounts").where("businessPhoneNormalized", "==", normalized).limit(2).get(),
    db.collection("accounts").where("accountPhone", "in", accountPhoneVariants).limit(2).get(),
  ]);
  if ([...businessMatches.docs, ...accountMatches.docs].some((document) => document.id !== clientId)) return { error: "That phone number is already registered." };
  return { normalized };
}

export async function GET(request) {
  const access = await resolveClient(request);
  if (access.response) return access.response;
  const loaded = await loadProfile(getAdminDb(), access.clientId);
  if (!loaded) return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  return NextResponse.json({ profile: profilePayload(access.clientId, loaded.account) });
}

export async function POST(request) {
  const body = await request.json();
  const access = await resolveClient(request);
  if (access.response) return access.response;
  const db = getAdminDb();
  const loaded = await loadProfile(db, access.clientId);
  if (!loaded) return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });

  const current = profilePayload(access.clientId, loaded.account);
  const serviceAreas = body.serviceAreas ?? current.serviceAreas;
  const serviceAreaError = serviceAreaValidationError(serviceAreas);
  if (serviceAreaError) return NextResponse.json({ error: serviceAreaError }, { status: 400 });
  const regularService = normalizeRegularServiceSettings({
    regularServiceEveryDay: body.regularServiceEveryDay ?? current.regularServiceEveryDay,
    regularService24Hours: body.regularService24Hours ?? current.regularService24Hours,
  });
  const profile = {
    ...current,
    businessName: text(body.businessName ?? current.businessName),
    ownerName: text(body.ownerName ?? current.ownerName),
    businessPhone: text(body.businessPhone ?? current.businessPhone),
    businessEmail: text(body.businessEmail ?? current.businessEmail).toLowerCase(),
    timeZone: text(body.timeZone ?? current.timeZone),
    estimateWeekdays: regularService.regularServiceEveryDay ? REGULAR_SERVICE_WEEKDAYS : list(body.estimateWeekdays ?? current.estimateWeekdays).map((day) => day.toLowerCase()),
    earliestEstimateStart: regularService.regularService24Hours ? "" : text(body.earliestEstimateStart ?? current.earliestEstimateStart),
    latestEstimateStart: regularService.regularService24Hours ? "" : text(body.latestEstimateStart ?? current.latestEstimateStart),
    ...regularService,
    ...normalizeEmergencyServiceSettings({
      emergencyServiceEnabled: body.emergencyServiceEnabled ?? current.emergencyServiceEnabled,
      emergencyService24Hours: body.emergencyService24Hours ?? current.emergencyService24Hours,
    }),
    businessType: canonicalBusinessType(body.businessType ?? current.businessType) || text(body.businessType ?? current.businessType),
    serviceAreas: normalizeServiceAreas(serviceAreas),
    services: servicesObject(body.services ?? current.services),
    businessInformation: normalizeBusinessInformation(body.businessInformation ?? current.businessInformation),
  };
  const servicesClearedForBusinessTypeChange = profile.businessType !== current.businessType
    && Object.keys(profile.services).length === 0;
  const validationError = validateProfile(profile, { allowEmptyServices: servicesClearedForBusinessTypeChange });
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const [nameCheck, phoneCheck] = await Promise.all([
    validateBusinessName(db, access.clientId, profile.businessName),
    validateBusinessPhone(db, access.clientId, profile.businessPhone),
  ]);
  if (nameCheck.error) return NextResponse.json({ error: nameCheck.error }, { status: 409 });
  if (phoneCheck.error) return NextResponse.json({ error: phoneCheck.error }, { status: phoneCheck.error.startsWith("Enter") ? 400 : 409 });

  const businessUpdate = {
    businessName: profile.businessName,
    businessPhone: profile.businessPhone,
    businessEmail: profile.businessEmail,
    timeZone: profile.timeZone,
    estimateWeekdays: profile.estimateWeekdays,
    earliestEstimateStart: profile.earliestEstimateStart,
    latestEstimateStart: profile.latestEstimateStart,
    regularServiceEveryDay: profile.regularServiceEveryDay,
    regularService24Hours: profile.regularService24Hours,
    emergencyServiceEnabled: profile.emergencyServiceEnabled,
    emergencyService24Hours: profile.emergencyService24Hours,
    businessType: profile.businessType,
    serviceAreas: profile.serviceAreas,
    services: profile.services,
    businessInformation: profile.businessInformation,
    extraInformation: businessInformationText(profile.businessInformation),
  };
  const rootUpdate = {
    businessSetupComplete: true,
    enabled: profile.enabled,
    receptionistEnabled: Boolean(profile.receptionistPhoneNormalized) && profile.enabled,
    receptionistPhone: profile.receptionistPhone,
    receptionistPhoneNormalized: profile.receptionistPhoneNormalized,
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    businessPhoneNormalized: phoneCheck.normalized,
    updatedBy: access.user.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(loaded.businessRef, {
    ...businessUpdate,
    updatedBy: access.user.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(loaded.ref, {
    ...rootUpdate,
    ...businessRootFieldDeletes(FieldValue.delete()),
    businessNameKey: nameCheck.businessNameKey === access.clientId ? FieldValue.delete() : nameCheck.businessNameKey,
    accountPhoneNormalized: FieldValue.delete(),
    estimateDays: FieldValue.delete(),
    businessBase: FieldValue.delete(),
    businessHours: FieldValue.delete(),
    businessWeekdays: FieldValue.delete(),
    businessStartHour: FieldValue.delete(),
    businessStartPeriod: FieldValue.delete(),
    businessEndHour: FieldValue.delete(),
    businessEndPeriod: FieldValue.delete(),
  });
  await batch.commit();
  return NextResponse.json({ profile: profilePayload(access.clientId, { ...loaded.account, ...rootUpdate, ...businessUpdate }) });
}
