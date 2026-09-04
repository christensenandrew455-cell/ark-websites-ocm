export const EMERGENCY_REQUEST_URGENCY = "emergency";
export const ASAP_REQUEST_TIME = "As soon as possible";
export const ASAP_OR_SCHEDULED_QUESTION = "Do you need help right away, or would you like to schedule service?";
export const REGULAR_SERVICE_WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

const EMERGENCY_VALUES = new Set([
  "asap",
  "as-soon-as-possible",
  "emergency",
  "immediate",
  "immediate-service",
  "urgent",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function booleanSetting(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "on", "true", "yes"].includes(normalized);
}

function urgencyValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = object(value);
  const fields = [
    "RequestUrgency",
    "requestUrgency",
    "serviceUrgency",
    "urgency",
    "isEmergency",
    "emergencyRequest",
    "needsImmediateService",
  ];
  const field = fields.find((key) => Object.hasOwn(source, key));
  return field ? source[field] : "";
}

export function normalizeEmergencyServiceSettings(value = {}) {
  const source = object(value);
  const emergencyServiceRequested = booleanSetting(
    source.emergencyServiceEnabled ?? source.acceptsEmergencyRequests,
  );
  const emergencyService24Hours = emergencyServiceRequested && booleanSetting(
    source.emergencyService24Hours ?? source.emergencyAvailable24Hours,
  );
  return {
    emergencyServiceEnabled: emergencyService24Hours,
    emergencyService24Hours,
  };
}

export function normalizeRegularServiceSettings(value = {}) {
  const source = object(value);
  return {
    regularServiceEveryDay: booleanSetting(source.regularServiceEveryDay),
    regularService24Hours: booleanSetting(source.regularService24Hours),
  };
}

export function normalizeRequestUrgency(value) {
  const candidate = urgencyValue(value);
  if (candidate === true || candidate === 1) return EMERGENCY_REQUEST_URGENCY;
  const normalized = String(candidate || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return EMERGENCY_VALUES.has(normalized) ? EMERGENCY_REQUEST_URGENCY : "";
}

export function isEmergencyRequest(value) {
  return normalizeRequestUrgency(value) === EMERGENCY_REQUEST_URGENCY;
}

export function regularServiceScheduleConfigured(value = {}) {
  const source = object(value);
  const settings = normalizeRegularServiceSettings(source);
  const days = settings.regularServiceEveryDay
    ? REGULAR_SERVICE_WEEKDAYS
    : Array.isArray(source.estimateWeekdays) ? source.estimateWeekdays.filter(Boolean) : [];
  const start = String(source.earliestEstimateStart || "").trim()
    || (source.estimateStartHour && source.estimateStartPeriod ? `${source.estimateStartHour} ${source.estimateStartPeriod}` : "");
  const end = String(source.latestEstimateStart || "").trim()
    || (source.estimateEndHour && source.estimateEndPeriod ? `${source.estimateEndHour} ${source.estimateEndPeriod}` : "");
  return Boolean(days.length && (settings.regularService24Hours || (start && end)));
}

export function activeEmergencyServiceSettings(value = {}) {
  return normalizeEmergencyServiceSettings(value);
}

export function receptionistRequestRouting(value = {}) {
  const settings = activeEmergencyServiceSettings(value);
  const scheduled = {
    enabled: true,
    label: "Scheduled service",
    instruction: "Always offer normal scheduling and collect the caller's preferred day and time window.",
  };
  if (!settings.emergencyServiceEnabled) {
    return {
      mode: "scheduled-only",
      timingQuestion: "",
      scheduled,
    };
  }
  return {
    mode: "asap-or-scheduled",
    timingQuestion: ASAP_OR_SCHEDULED_QUESTION,
    scheduled,
    emergency: {
      enabled: true,
      label: "24/7 emergency service",
      availability: "24/7",
      intakeField: "requestUrgency",
      intakeValue: EMERGENCY_REQUEST_URGENCY,
      requestedTimeWindow: ASAP_REQUEST_TIME,
      instruction: "When the caller needs help right away, mark the request as emergency and collect the problem and location, but do not promise dispatch or an arrival time. For fire, a gas odor, carbon monoxide, or another immediate danger, tell the caller to leave the area and contact emergency services or the utility first.",
    },
  };
}
