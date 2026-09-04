import { canonicalBusinessType } from "./businessCatalog.js";
import { REGULAR_SERVICE_WEEKDAYS } from "./emergencyService.js";

const EMPTY_REGULAR_SERVICE_TIMES = Object.freeze({
  estimateStartHour: "",
  estimateStartPeriod: "",
  estimateEndHour: "",
  estimateEndPeriod: "",
});

function profileObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function businessTypeKey(value) {
  return canonicalBusinessType(value) || String(value || "").trim().toLowerCase();
}

export function changeReceptionistBusinessType(profile, value) {
  const source = profileObject(profile);
  const businessType = canonicalBusinessType(value) || String(value || "").trim();
  const changed = businessTypeKey(source.businessType || source.businessBase) !== businessTypeKey(businessType);
  return {
    ...source,
    businessType,
    ...(changed ? { services: {} } : {}),
  };
}

export function setRegularServiceEveryDay(profile, enabled) {
  const source = profileObject(profile);
  const regularServiceEveryDay = enabled === true;
  return {
    ...source,
    regularServiceEveryDay,
    estimateWeekdays: regularServiceEveryDay ? [...REGULAR_SERVICE_WEEKDAYS] : [],
  };
}

export function setRegularService24Hours(profile, enabled) {
  const source = profileObject(profile);
  const regularService24Hours = enabled === true;
  return {
    ...source,
    regularService24Hours,
    ...(!regularService24Hours ? EMPTY_REGULAR_SERVICE_TIMES : {}),
  };
}

export function setEmergencyService24Hours(profile, enabled) {
  const source = profileObject(profile);
  const emergencyServiceEnabled = enabled === true;
  return {
    ...source,
    emergencyServiceEnabled,
    emergencyService24Hours: emergencyServiceEnabled,
  };
}
