import { systemCollection } from "./firestoreLayout.js";
import { normalizeClientId } from "./valueUtils.js";

export const PARTNER_CODE_COLLECTION = "partnerCodes";
export const DEFAULT_PARTNER_COMMISSION_BASIS_POINTS = 2_000;

function text(value, maximum = 180) {
  return String(value || "").trim().slice(0, maximum);
}

function commissionBasisPoints(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PARTNER_COMMISSION_BASIS_POINTS;
  return Math.max(1, Math.min(10_000, Math.round(parsed)));
}

export function normalizePartnerCode(value) {
  return normalizeClientId(value).slice(0, 40);
}

export function displayPartnerCode(value) {
  return normalizePartnerCode(value).toUpperCase();
}

export function partnerAccountFields(attribution = {}) {
  if (attribution.type !== "partner" || !attribution.partnerCode) return {};
  return {
    signupAttributionType: "partner",
    partnerCode: attribution.partnerCode,
    partnerCodeDisplay: attribution.partnerCodeDisplay,
    partnerName: attribution.partnerName,
    partnerCommissionBasisPoints: attribution.partnerCommissionBasisPoints,
  };
}

export async function resolveSignupAttribution({ db, code }) {
  const normalizedCode = normalizePartnerCode(code);
  if (!normalizedCode) return { type: "none" };

  const partnerSnapshot = await systemCollection(db, PARTNER_CODE_COLLECTION).doc(normalizedCode).get();
  if (partnerSnapshot.exists) {
    const partner = partnerSnapshot.data() || {};
    const active = partner.active !== false && text(partner.status).toLowerCase() !== "inactive";
    if (!active) return { type: "inactive-partner", partnerCode: normalizedCode };
    return {
      type: "partner",
      partnerCode: normalizedCode,
      partnerCodeDisplay: displayPartnerCode(partner.codeDisplay || normalizedCode),
      partnerName: text(partner.partnerName || partner.name || normalizedCode),
      partnerCommissionBasisPoints: commissionBasisPoints(partner.commissionBasisPoints),
    };
  }

  return { type: "referral", referralCode: normalizeClientId(code) };
}
