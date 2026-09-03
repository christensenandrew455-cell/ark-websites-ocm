export const LEAD_RISK_VERSION = "lead-risk-v1";

export const LEAD_RISK_LEVELS = Object.freeze({
  low: Object.freeze({ label: "Low risk", minimum: 0, maximum: 2 }),
  moderate: Object.freeze({ label: "Moderate risk", minimum: 3, maximum: 5 }),
  high: Object.freeze({ label: "High risk", minimum: 6, maximum: 8 }),
  "very-high": Object.freeze({ label: "Very high risk", minimum: 9, maximum: null }),
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function firstValue(sources, names) {
  for (const source of sources) {
    for (const name of names) {
      if (present(source[name])) return source[name];
    }
  }
  return undefined;
}

function optionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1", "failed", "invalid", "mismatch", "outside", "voip"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "success", "valid", "match", "inside", "landline", "mobile", "wireless"].includes(normalized)) return false;
  return null;
}

function statusMatches(value, matches) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return matches.includes(normalized);
}

function resistancePoints(count) {
  if (count >= 6) return 3;
  if (count >= 4) return 2;
  if (count >= 2) return 1;
  return 0;
}

export function leadRiskLevel(score) {
  const points = Math.max(0, Math.floor(Number(score) || 0));
  if (points <= 2) return "low";
  if (points <= 5) return "moderate";
  if (points <= 8) return "high";
  return "very-high";
}

export function leadRiskLabel(level) {
  return LEAD_RISK_LEVELS[level]?.label || LEAD_RISK_LEVELS.low.label;
}

export function calculateLeadRisk(input = {}) {
  const root = object(input);
  const assessment = object(root.riskAssessment);
  const risk = object(root.risk);
  const riskChecks = object(risk.checks);
  const addressCheck = object(riskChecks.address);
  const phoneCheck = object(riskChecks.phone);
  const backgroundCheck = object(root.backgroundCheck);
  const sources = [
    object(assessment.signals),
    assessment,
    object(risk.signals),
    risk,
    object(backgroundCheck.signals),
    backgroundCheck,
    object(root.signals),
    root,
  ];

  const addressVerifiedValue = firstValue(sources, ["addressVerified", "isAddressVerified"]);
  const addressFailureValue = firstValue(sources, ["addressVerificationFailed", "addressInvalid", "invalidAddress"]);
  const addressStatus = firstValue([addressCheck], ["status"])
    ?? firstValue(sources, ["addressVerificationStatus", "addressStatus"]);
  const addressVerified = optionalBoolean(addressVerifiedValue);
  const addressCheckUnavailable = statusMatches(addressStatus, ["not_configured", "error", "unavailable"]);
  const addressUnverified = optionalBoolean(addressFailureValue) === true
    || statusMatches(addressStatus, ["failed", "invalid", "unverified", "not_found"])
    || (addressVerified === false && !addressCheckUnavailable);

  const outsideValue = firstValue(sources, ["outsideServiceArea", "serviceAddressOutsideArea", "addressOutsideServiceArea"]);
  const insideValue = firstValue(sources, ["insideServiceArea", "inServiceArea", "serviceable"]);
  const outsideServiceArea = optionalBoolean(outsideValue) === true
    || optionalBoolean(insideValue) === false;

  const lookupFailureValue = firstValue(sources, ["phoneLookupFailed", "phoneInvalid", "invalidPhoneNumber", "phoneNumberInvalid"]);
  const lookupStatus = firstValue([phoneCheck], ["status"])
    ?? firstValue(sources, ["phoneLookupStatus", "telnyxLookupStatus"]);
  const phoneLookupFailed = optionalBoolean(lookupFailureValue) === true
    || statusMatches(lookupStatus, ["failed", "invalid", "not_found", "unavailable", "error"]);

  const phoneLocationMismatch = !phoneLookupFailed && optionalBoolean(firstValue(sources, [
    "phoneLocationMismatch",
    "phoneAreaMismatch",
    "phoneAddressAreaMismatch",
  ])) === true;

  const lineType = firstValue(sources, ["phoneLineType", "lineType", "telnyxLineType"]);
  const voipPhoneNumber = !phoneLookupFailed && (
    optionalBoolean(firstValue(sources, ["voipPhoneNumber", "phoneIsVoip", "isVoip", "voip"])) === true
    || statusMatches(lineType, ["voip", "voice_over_ip"])
  );

  const callerNameMismatch = !phoneLookupFailed && optionalBoolean(firstValue(sources, [
    "callerNameMismatch",
    "cnamMismatch",
  ])) === true;
  const callerNameUnavailable = !phoneLookupFailed && !callerNameMismatch && optionalBoolean(firstValue(sources, [
    "callerNameUnavailable",
    "cnamUnavailable",
  ])) === true;

  const resistanceValue = firstValue(sources, [
    "customerResistanceCount",
    "resistanceCount",
    "requiredInfoResistanceCount",
    "refusalCount",
  ]);
  const resistanceCount = Math.max(0, Math.floor(Number(resistanceValue) || 0));
  const resistanceScore = resistancePoints(resistanceCount);

  const breakdown = [
    outsideServiceArea && { key: "outside-service-area", label: "Service address is outside the normal service area", points: 1 },
    phoneLocationMismatch && { key: "phone-location-mismatch", label: "Phone location does not match the service-address area", points: 1 },
    voipPhoneNumber && { key: "voip-phone", label: "Phone number is VoIP", points: 1 },
    callerNameUnavailable && { key: "caller-name-unavailable", label: "Caller-name information is unavailable", points: 1 },
    callerNameMismatch && { key: "caller-name-mismatch", label: "Caller name does not match the supplied name", points: 2 },
    addressUnverified && { key: "address-unverified", label: "Service address could not be verified", points: 4 },
    phoneLookupFailed && { key: "phone-lookup-failed", label: "Phone lookup failed or the number appears invalid", points: 4 },
    resistanceScore > 0 && { key: "customer-resistance", label: `Required-information resistance occurred ${resistanceCount} times`, points: resistanceScore },
  ].filter(Boolean);

  const score = breakdown.reduce((total, item) => total + item.points, 0);
  const assessed = [
    addressVerifiedValue,
    addressFailureValue,
    addressStatus,
    outsideValue,
    insideValue,
    lookupFailureValue,
    lookupStatus,
    firstValue(sources, ["phoneLocationMismatch", "phoneAreaMismatch", "phoneAddressAreaMismatch"]),
    firstValue(sources, ["voipPhoneNumber", "phoneIsVoip", "isVoip", "voip"]),
    lineType,
    firstValue(sources, ["callerNameMismatch", "cnamMismatch"]),
    firstValue(sources, ["callerNameUnavailable", "cnamUnavailable"]),
    resistanceValue,
  ].some(present);

  return {
    version: LEAD_RISK_VERSION,
    assessed,
    score,
    level: leadRiskLevel(score),
    signals: {
      addressVerified: addressUnverified ? false : addressVerified,
      outsideServiceArea,
      phoneLocationMismatch,
      voipPhoneNumber,
      callerNameUnavailable,
      callerNameMismatch,
      phoneLookupFailed,
      resistanceCount,
    },
    breakdown,
  };
}
