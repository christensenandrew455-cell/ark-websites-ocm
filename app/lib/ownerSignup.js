import { PRIVACY_VERSION, TERMS_VERSION } from "./legal.js";
import { canonicalBusinessType, isSupportedBusinessType } from "./businessCatalog.js";
import { businessInformationText, normalizeBusinessInformation } from "./receptionistBusinessInformation.js";
import { emergencyServiceAvailabilityError, normalizeEmergencyServiceSettings, normalizeRegularServiceSettings, REGULAR_SERVICE_WEEKDAYS } from "./emergencyService.js";
import { normalizeServiceAreas, serviceAreaValidationError } from "./serviceAreas.js";
import { normalizeClientId, trimmedText } from "./valueUtils.js";

export const OWNER_SIGNUP_VERSION = 5;

const WEEKDAYS = REGULAR_SERVICE_WEEKDAYS;
const PERIODS = new Set(["AM", "PM"]);

function cleanText(value, maximum = 500) {
  return trimmedText(value).slice(0, maximum);
}

function hour(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : "";
}

function period(value) {
  const normalized = cleanText(value, 2).toUpperCase();
  return PERIODS.has(normalized) ? normalized : "";
}

function weekdayList(value) {
  if (Array.isArray(value)) {
    const selected = new Set(value.map((item) => cleanText(item, 12).toLowerCase()));
    return WEEKDAYS.filter((day) => selected.has(day));
  }
  const source = cleanText(value, 200).toLowerCase();
  if (!source) return [];
  const selected = WEEKDAYS.filter((day) => source.includes(day));
  return selected;
}

function textList(value, maximumItems = 100, maximumLength = 160) {
  const source = Array.isArray(value) ? value : cleanText(value, 10_000).split(/[\n,]/);
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const cleaned = cleanText(item, maximumLength);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function servicesObject(value) {
  const entries = value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : textList(value).map((item) => [item, item]);
  return Object.fromEntries(entries
    .map(([name, description]) => {
      const cleanName = cleanText(name, 120).toLowerCase();
      return [cleanName, cleanText(description, 500) || cleanName];
    })
    .filter(([name]) => name)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 100));
}

function timeSummary(selectedHour, selectedPeriod) {
  return `${selectedHour}:00 ${selectedPeriod}`;
}

export function normalizeOwnerSignup(value = {}, { includePassword = true } = {}) {
  const receptionist = value.receptionist && typeof value.receptionist === "object" ? value.receptionist : {};
  const businessName = cleanText(value.businessName || receptionist.businessName, 120);
  const ownerName = cleanText(value.ownerName || value.personName || receptionist.ownerName, 120);
  const accountEmail = cleanText(value.accountEmail || receptionist.businessEmail, 254).toLowerCase();
  const accountPhone = cleanText(value.accountPhone || receptionist.businessPhone, 30);
  const regularService = normalizeRegularServiceSettings(receptionist);
  const estimateWeekdays = regularService.regularServiceEveryDay ? WEEKDAYS : weekdayList(receptionist.estimateWeekdays);
  const estimateStartHour = hour(receptionist.estimateStartHour);
  const estimateStartPeriod = period(receptionist.estimateStartPeriod);
  const estimateEndHour = hour(receptionist.estimateEndHour);
  const estimateEndPeriod = period(receptionist.estimateEndPeriod);
  const timeZone = cleanText(receptionist.timeZone, 80).toLowerCase() === "choose" ? "" : cleanText(receptionist.timeZone, 80);
  const estimateStartComplete = estimateStartHour && estimateStartPeriod;
  const estimateEndComplete = estimateEndHour && estimateEndPeriod;
  const businessInformation = normalizeBusinessInformation(receptionist.businessInformation);
  const emergencyService = normalizeEmergencyServiceSettings(receptionist);

  return {
    version: OWNER_SIGNUP_VERSION,
    businessName,
    ownerName,
    accountEmail,
    accountPhone,
    referralCode: normalizeClientId(value.referralCode),
    ...(includePassword ? { password: String(value.password || "").slice(0, 256) } : {}),
    acceptedTerms: value.acceptedTerms === true,
    acceptedPrivacy: value.acceptedPrivacy === true,
    termsVersion: cleanText(value.termsVersion, 40),
    privacyVersion: cleanText(value.privacyVersion, 40),
    businessInformationCompleted: value.businessInformationCompleted === true,
    receptionist: {
      businessName,
      ownerName,
      businessPhone: accountPhone,
      businessEmail: accountEmail,
      timeZone,
      estimateWeekdays,
      estimateStartHour,
      estimateStartPeriod,
      estimateEndHour,
      estimateEndPeriod,
      earliestEstimateStart: estimateStartComplete ? timeSummary(estimateStartHour, estimateStartPeriod) : "",
      latestEstimateStart: estimateEndComplete ? timeSummary(estimateEndHour, estimateEndPeriod) : "",
      ...regularService,
      ...emergencyService,
      businessType: canonicalBusinessType(receptionist.businessType || receptionist.businessBase) || cleanText(receptionist.businessType || receptionist.businessBase, 120),
      serviceAreas: normalizeServiceAreas(textList(receptionist.serviceAreas)),
      services: servicesObject(receptionist.services),
      ...(businessInformation.length ? { businessInformation } : {}),
      extraInformation: businessInformation.length ? businessInformationText(businessInformation) : cleanText(receptionist.extraInformation, 2_000),
    },
  };
}

export function validateOwnerAccountInformation(value = {}, { requirePassword = true } = {}) {
  const signup = normalizeOwnerSignup(value, { includePassword: true });
  if (!normalizeClientId(signup.businessName)) return "Enter the business name.";
  if (!signup.ownerName) return "Enter the owner name.";
  if (!/^\S+@\S+\.\S+$/.test(signup.accountEmail)) return "Enter a valid email address.";
  if (signup.accountPhone.replace(/\D/g, "").length !== 10) return "Enter a 10-digit phone number.";
  if (requirePassword && signup.password.length < 8) return "Use a password with at least 8 characters.";
  if (!signup.acceptedTerms || !signup.acceptedPrivacy) return "Agree to the Terms of Use and Privacy Policy before continuing.";
  if (signup.termsVersion !== TERMS_VERSION || signup.privacyVersion !== PRIVACY_VERSION) return "The legal policies were updated. Start signup again and review the current versions.";
  return "";
}

export function validateOwnerSignup(value = {}, { requirePassword = true } = {}) {
  const signup = normalizeOwnerSignup(value, { includePassword: true });
  return validateOwnerAccountInformation(signup, { requirePassword })
    || validateReceptionistBusinessInformation(value.receptionist || signup.receptionist);
}

export function validateReceptionistBusinessInformation(value = {}) {
  const serviceAreaError = serviceAreaValidationError(value.serviceAreas);
  const receptionist = normalizeOwnerSignup({ receptionist: value }, { includePassword: false }).receptionist;
  if (!receptionist.timeZone) return "Choose a time zone.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: receptionist.timeZone }).format();
  } catch {
    return "Choose a valid time zone.";
  }
  if (!receptionist.businessType) return "Enter the type of business.";
  if (!isSupportedBusinessType(receptionist.businessType)) return "Choose a business type from the list.";
  const hasEstimateSchedule = Boolean(receptionist.regularServiceEveryDay || receptionist.regularService24Hours || receptionist.estimateWeekdays.length || receptionist.estimateStartHour || receptionist.estimateStartPeriod || receptionist.estimateEndHour || receptionist.estimateEndPeriod);
  if (hasEstimateSchedule && !receptionist.estimateWeekdays.length) return "Choose at least one regular service day or leave the regular schedule blank.";
  if (hasEstimateSchedule && !receptionist.regularService24Hours && (!receptionist.estimateStartHour || !receptionist.estimateStartPeriod)) return "Choose when the business opens or turn on Open 24 hours.";
  if (hasEstimateSchedule && !receptionist.regularService24Hours && (!receptionist.estimateEndHour || !receptionist.estimateEndPeriod)) return "Choose when the business closes or turn on Open 24 hours.";
  const emergencyAvailabilityError = emergencyServiceAvailabilityError(receptionist);
  if (emergencyAvailabilityError) return emergencyAvailabilityError;
  if (serviceAreaError) return serviceAreaError;
  if (!Object.keys(receptionist.services).length) return "Add at least one service.";
  return "";
}
