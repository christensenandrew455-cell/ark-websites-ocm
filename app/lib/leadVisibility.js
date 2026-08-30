import { calculateLeadRisk, leadRiskLevel } from "./leadRiskAssessment.js";

function text(value, maximum = 300) {
  return String(value || "").trim().slice(0, maximum);
}

function riskSummary(data) {
  const calculated = calculateLeadRisk(data.riskAssessment || data);
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
  return {
    id: text(id, 300),
    collectionKey: "contactedMe",
    Name: text(data.Name || data.name || data.fullName, 160),
    Job: text(data.Job || data.job || data.service || data.projectType || data.requestedService, 180),
    EstimateDate: text(data.EstimateDate || data.estimateDate || data.PreferredDate || data.preferredDate || data.PreferredDay || data.preferredDay || data.requestedDate, 40),
    EstimateTime: text(data.EstimateTime || data.estimateTime || data.PreferredTime || data.preferredTime || data.requestedTime, 40),
    ...riskSummary(data),
    createdAt: data.createdAt,
    contactedAt: data.contactedAt,
    updatedAt: data.updatedAt,
  };
}
