export const EMERGENCY_REQUEST_URGENCY = "emergency";
export const ASAP_REQUEST_TIME = "As soon as possible";
export const ASAP_OR_SCHEDULED_QUESTION = "Do you need help as soon as possible, or would you prefer to schedule a time?";

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
  const emergencyServiceEnabled = booleanSetting(
    source.emergencyServiceEnabled ?? source.acceptsEmergencyRequests,
  );
  const emergencyService24Hours = emergencyServiceEnabled && booleanSetting(
    source.emergencyService24Hours ?? source.emergencyAvailable24Hours,
  );
  return { emergencyServiceEnabled, emergencyService24Hours };
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
  const days = Array.isArray(source.estimateWeekdays) ? source.estimateWeekdays.filter(Boolean) : [];
  const start = String(source.earliestEstimateStart || "").trim()
    || (source.estimateStartHour && source.estimateStartPeriod ? `${source.estimateStartHour} ${source.estimateStartPeriod}` : "");
  const end = String(source.latestEstimateStart || "").trim()
    || (source.estimateEndHour && source.estimateEndPeriod ? `${source.estimateEndHour} ${source.estimateEndPeriod}` : "");
  return Boolean(days.length && start && end);
}

export function emergencyServiceAvailabilityError(value = {}) {
  const settings = normalizeEmergencyServiceSettings(value);
  if (!settings.emergencyServiceEnabled || settings.emergencyService24Hours || regularServiceScheduleConfigured(value)) return "";
  return "Add regular service days and times, or turn on 24/7 emergency availability.";
}

export function activeEmergencyServiceSettings(value = {}) {
  const settings = normalizeEmergencyServiceSettings(value);
  if (emergencyServiceAvailabilityError({ ...object(value), ...settings })) {
    return { emergencyServiceEnabled: false, emergencyService24Hours: false };
  }
  return settings;
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
      label: "Emergency / ASAP service",
      availability: settings.emergencyService24Hours ? "24/7" : "regular-service-hours",
      intakeField: "requestUrgency",
      intakeValue: EMERGENCY_REQUEST_URGENCY,
      requestedTimeWindow: ASAP_REQUEST_TIME,
      instruction: "When the caller chooses help as soon as possible, mark the request as emergency and do not promise a dispatch or arrival time.",
    },
  };
}
