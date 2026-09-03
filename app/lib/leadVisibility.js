import { calculateLeadRisk, leadRiskLevel } from "./leadRiskAssessment.js";
import { normalizeRequestUrgency } from "./emergencyService.js";

function text(value, maximum = 300) {
  return String(value || "").trim().slice(0, maximum);
}

function riskSummary(data) {
  const calculated = calculateLeadRisk(data);
  const storedScore = Number(data.riskAssessment?.score ?? data.riskScore);
  const score = Number.isFinite(storedScore) ? Math.max(0, Math.floor(storedScore)) : calculated.score;
  const storedAssessed = typeof data.riskAssessment?.assessed === "boolean"
    ? data.riskAssessment.assessed
    : typeof data.riskAssessed === "boolean"
      ? data.riskAssessed
      : null;
  return {
    riskAssessed: storedAssessed ?? calculated.assessed,
    riskScore: score,
    riskLevel: leadRiskLevel(score),
  };
}

export function pendingLeadSummary(id, source = {}) {
  const data = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const RequestUrgency = normalizeRequestUrgency(data);
  return {
    id: text(id, 300),
    collectionKey: "contactedMe",
    Job: text(data.Job || data.job || data.service || data.projectType || data.requestedService, 180),
    PreferredDay: text(data.PreferredDay || data.preferredDay || data.PreferredDate || data.preferredDate || data.requestedDate || data.EstimateDate || data.estimateDate, 40),
    PreferredTimeWindow: text(data.PreferredTimeWindow || data.preferredTimeWindow || data.requestedTimeWindow || data.PreferredTime || data.preferredTime || data.requestedTime || data.EstimateTime || data.estimateTime, 40),
    Notes: text(data.ClientNotes || data.clientNotes || data.Notes || data.notes || data.additionalNotes, 1_000),
    ...(RequestUrgency ? { RequestUrgency } : {}),
    ...riskSummary(data),
    createdAt: data.createdAt,
    contactedAt: data.contactedAt,
    updatedAt: data.updatedAt,
  };
}
