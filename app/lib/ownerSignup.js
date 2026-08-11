import { PRIVACY_VERSION, TERMS_VERSION } from "./legal.js";
import { normalizeClientId, trimmedText } from "./valueUtils.js";

export const OWNER_SIGNUP_DRAFT_KEY = "ark-owner-signup-draft-v2";
export const OWNER_SIGNUP_DRAFT_VERSION = 2;
export const OWNER_SIGNUP_DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const DASHBOARD_ONBOARDING_KEY = "ark-dashboard-onboarding-v1";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
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

function titleCase(value) {
  const text = cleanText(value, 20);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function daySummary(days) {
  const labels = WEEKDAYS.filter((day) => days.includes(day)).map(titleCase);
  if (labels.length === 7) return "every day";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return labels.length ? `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}` : "no selected days";
}

function timeSummary(selectedHour, selectedPeriod) {
  return `${selectedHour}:00 ${selectedPeriod}`;
}

function timeMinutes(selectedHour, selectedPeriod) {
  const normalizedHour = selectedHour % 12;
  return (normalizedHour + (selectedPeriod === "PM" ? 12 : 0)) * 60;
}

export function normalizeOwnerSignup(value = {}, { includePassword = true } = {}) {
  const receptionist = value.receptionist && typeof value.receptionist === "object" ? value.receptionist : {};
  const businessName = cleanText(value.businessName || receptionist.businessName, 120);
  const ownerName = cleanText(value.ownerName || value.personName || receptionist.ownerName, 120);
  const accountEmail = cleanText(value.accountEmail || receptionist.businessEmail, 254).toLowerCase();
  const accountPhone = cleanText(value.accountPhone || receptionist.businessPhone, 30);
  const businessWeekdays = weekdayList(receptionist.businessWeekdays);
  const estimateWeekdays = weekdayList(receptionist.estimateWeekdays);
  const businessStartHour = hour(receptionist.businessStartHour);
  const businessStartPeriod = period(receptionist.businessStartPeriod);
  const businessEndHour = hour(receptionist.businessEndHour);
  const businessEndPeriod = period(receptionist.businessEndPeriod);
  const estimateStartHour = hour(receptionist.estimateStartHour);
  const estimateStartPeriod = period(receptionist.estimateStartPeriod);
  const estimateEndHour = hour(receptionist.estimateEndHour);
  const estimateEndPeriod = period(receptionist.estimateEndPeriod);
  const timeZone = cleanText(receptionist.timeZone, 80).toLowerCase() === "choose" ? "" : cleanText(receptionist.timeZone, 80);
  const businessHoursComplete = businessWeekdays.length && businessStartHour && businessStartPeriod && businessEndHour && businessEndPeriod;
  const estimateStartComplete = estimateStartHour && estimateStartPeriod;
  const estimateEndComplete = estimateEndHour && estimateEndPeriod;

  return {
    version: OWNER_SIGNUP_DRAFT_VERSION,
    businessName,
    ownerName,
    accountEmail,
    accountPhone,
    ...(includePassword ? { password: String(value.password || "").slice(0, 256) } : {}),
    referrerAccountId: normalizeClientId(value.referrerAccountId),
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
      businessWeekdays,
      businessStartHour,
      businessStartPeriod,
      businessEndHour,
      businessEndPeriod,
      businessHours: businessHoursComplete ? `Open ${daySummary(businessWeekdays)} from ${timeSummary(businessStartHour, businessStartPeriod)} to ${timeSummary(businessEndHour, businessEndPeriod)}.` : "",
      estimateDays: estimateWeekdays.length ? daySummary(estimateWeekdays) : "",
      estimateWeekdays,
      estimateStartHour,
      estimateStartPeriod,
      estimateEndHour,
      estimateEndPeriod,
      earliestEstimateStart: estimateStartComplete ? timeSummary(estimateStartHour, estimateStartPeriod) : "",
      latestEstimateStart: estimateEndComplete ? timeSummary(estimateEndHour, estimateEndPeriod) : "",
      businessBase: cleanText(receptionist.businessBase, 200),
      serviceAreas: textList(receptionist.serviceAreas),
      services: servicesObject(receptionist.services),
      extraInformation: cleanText(receptionist.extraInformation, 2_000),
    },
  };
}

export function validateOwnerSignup(value = {}, { requirePassword = true } = {}) {
  const signup = normalizeOwnerSignup(value, { includePassword: true });
  if (!normalizeClientId(signup.businessName)) return "Enter the business name.";
  if (!signup.ownerName) return "Enter the owner name.";
  if (!/^\S+@\S+\.\S+$/.test(signup.accountEmail)) return "Enter a valid email address.";
  if (signup.accountPhone.replace(/\D/g, "").length !== 10) return "Enter a 10-digit phone number.";
  if (requirePassword && signup.password.length < 8) return "Use a password with at least 8 characters.";
  if (!signup.acceptedTerms || !signup.acceptedPrivacy) return "Agree to the Terms of Use and Privacy Policy before continuing.";
  if (signup.termsVersion !== TERMS_VERSION || signup.privacyVersion !== PRIVACY_VERSION) return "The legal policies were updated. Start signup again and review the current versions.";
  return validateReceptionistBusinessInformation(signup.receptionist);
}

export function validateReceptionistBusinessInformation(value = {}) {
  const receptionist = normalizeOwnerSignup({ receptionist: value }, { includePassword: false }).receptionist;
  if (!receptionist.timeZone) return "Choose a time zone.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: receptionist.timeZone }).format();
  } catch {
    return "Choose a valid time zone.";
  }
  if (!receptionist.businessWeekdays.length) return "Select at least one normal business day.";
  if (!receptionist.businessStartHour || !receptionist.businessStartPeriod) return "Choose the business opening time.";
  if (!receptionist.businessEndHour || !receptionist.businessEndPeriod) return "Choose the business closing time.";
  if (!receptionist.estimateWeekdays.length) return "Select at least one day available for estimates.";
  if (!receptionist.estimateStartHour || !receptionist.estimateStartPeriod) return "Choose the earliest estimate time.";
  if (!receptionist.estimateEndHour || !receptionist.estimateEndPeriod) return "Choose the latest estimate time.";
  if (timeMinutes(receptionist.estimateStartHour, receptionist.estimateStartPeriod) > timeMinutes(receptionist.estimateEndHour, receptionist.estimateEndPeriod)) return "The latest estimate time must be after the earliest estimate time.";
  if (!receptionist.serviceAreas.length) return "Add at least one service area.";
  if (!Object.keys(receptionist.services).length) return "Add at least one service.";
  return "";
}

export function ownerSignupDigestInput(value = {}) {
  const signup = normalizeOwnerSignup(value, { includePassword: true });
  delete signup.businessInformationCompleted;
  return JSON.stringify(signup);
}
