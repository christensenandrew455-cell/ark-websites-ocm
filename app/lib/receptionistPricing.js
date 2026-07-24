export const RECEPTIONIST_PLANS = Object.freeze([
  { key: "starter-25", name: "Starter 25", includedCalls: 25, monthlyCents: 4900, overageCents: 150 },
  { key: "starter-50", name: "Starter 50", includedCalls: 50, monthlyCents: 6900, overageCents: 135 },
  { key: "starter-75", name: "Starter 75", includedCalls: 75, monthlyCents: 8900, overageCents: 125 },
  { key: "core-100", name: "Core 100", includedCalls: 100, monthlyCents: 9900, overageCents: 115 },
  { key: "core-150", name: "Core 150", includedCalls: 150, monthlyCents: 12900, overageCents: 105 },
  { key: "growth-200", name: "Growth 200", includedCalls: 200, monthlyCents: 15900, overageCents: 95 },
  { key: "growth-300", name: "Growth 300", includedCalls: 300, monthlyCents: 21900, overageCents: 85 },
  { key: "growth-400", name: "Growth 400", includedCalls: 400, monthlyCents: 26900, overageCents: 75 },
  { key: "scale-500", name: "Scale 500", includedCalls: 500, monthlyCents: 31900, overageCents: 70 },
  { key: "scale-650", name: "Scale 650", includedCalls: 650, monthlyCents: 37900, overageCents: 65 },
  { key: "scale-800", name: "Scale 800", includedCalls: 800, monthlyCents: 43900, overageCents: 60 },
  { key: "scale-1000", name: "Scale 1000", includedCalls: 1000, monthlyCents: 49900, overageCents: 55 },
]);

export const DEFAULT_RECEPTIONIST_PLAN_KEY = RECEPTIONIST_PLANS[0].key;
export const CUSTOM_PRICING_STARTS_AT_CALLS = 1001;

const PLAN_BY_KEY = new Map(RECEPTIONIST_PLANS.map((plan) => [plan.key, plan]));

function wholeCalls(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function getReceptionistPlan(planKey) {
  return PLAN_BY_KEY.get(String(planKey || "").trim()) || PLAN_BY_KEY.get(DEFAULT_RECEPTIONIST_PLAN_KEY);
}

export function receptionistPlanSnapshot(planKey) {
  const plan = getReceptionistPlan(planKey);
  return {
    key: plan.key,
    name: plan.name,
    includedCalls: plan.includedCalls,
    monthlyCents: plan.monthlyCents,
    overageCents: plan.overageCents,
  };
}

export function receptionistPlanTotalCents(planOrKey, callCount) {
  const plan = typeof planOrKey === "string" ? getReceptionistPlan(planOrKey) : getReceptionistPlan(planOrKey?.key);
  const calls = wholeCalls(callCount);
  return plan.monthlyCents + Math.max(0, calls - plan.includedCalls) * plan.overageCents;
}

export function receptionistOverage(planOrKey, callCount) {
  const plan = typeof planOrKey === "string" ? getReceptionistPlan(planOrKey) : getReceptionistPlan(planOrKey?.key);
  const calls = wholeCalls(callCount);
  const overageCalls = Math.max(0, calls - plan.includedCalls);
  return {
    calls,
    remainingCalls: Math.max(0, plan.includedCalls - calls),
    overageCalls,
    overageAmountCents: overageCalls * plan.overageCents,
    estimatedTotalCents: plan.monthlyCents + overageCalls * plan.overageCents,
  };
}

export function bestReceptionistPlan(callCount) {
  const calls = wholeCalls(callCount);
  return RECEPTIONIST_PLANS.reduce((best, plan) => {
    if (!best) return plan;
    const planTotal = receptionistPlanTotalCents(plan, calls);
    const bestTotal = receptionistPlanTotalCents(best, calls);
    if (planTotal !== bestTotal) return planTotal < bestTotal ? plan : best;
    if (plan.monthlyCents !== best.monthlyCents) return plan.monthlyCents < best.monthlyCents ? plan : best;
    return plan.overageCents < best.overageCents ? plan : best;
  }, null);
}

function recommendationIndexes(recommendedIndex) {
  if (recommendedIndex <= 0) return [0, 1, 2];
  if (recommendedIndex >= RECEPTIONIST_PLANS.length - 1) {
    return [RECEPTIONIST_PLANS.length - 3, RECEPTIONIST_PLANS.length - 2, RECEPTIONIST_PLANS.length - 1];
  }
  return [recommendedIndex - 1, recommendedIndex, recommendedIndex + 1];
}

function recommendationLabel(index, recommendedIndex, optionIndex) {
  if (index === recommendedIndex) return "Recommended";
  if (index < recommendedIndex) return optionIndex === 0 ? "Lower monthly" : "Middle option";
  return optionIndex === 2 ? "Lower overage" : "More included";
}

export function receptionistPlanRecommendations(callCount) {
  const calls = wholeCalls(callCount);
  const recommended = bestReceptionistPlan(calls);
  const recommendedIndex = RECEPTIONIST_PLANS.findIndex((plan) => plan.key === recommended.key);
  return recommendationIndexes(recommendedIndex).map((index, optionIndex) => {
    const plan = RECEPTIONIST_PLANS[index];
    return {
      ...receptionistPlanSnapshot(plan.key),
      label: recommendationLabel(index, recommendedIndex, optionIndex),
      estimatedTotalCents: receptionistPlanTotalCents(plan, calls),
      expectedCalls: calls,
      recommended: plan.key === recommended.key,
    };
  });
}

export function receptionistPlanRange(planKey, maximumCalls = 5000) {
  const plan = getReceptionistPlan(planKey);
  let lowerCalls = null;
  let upperCalls = null;
  for (let calls = 0; calls <= maximumCalls; calls += 1) {
    if (bestReceptionistPlan(calls).key !== plan.key) continue;
    if (lowerCalls === null) lowerCalls = calls;
    upperCalls = calls;
  }
  return {
    lowerCalls: lowerCalls ?? 0,
    upperCalls: upperCalls === maximumCalls ? null : upperCalls,
  };
}

export function monthKeyInTimeZone(date = new Date(), timeZone = "UTC") {
  let safeZone = String(timeZone || "UTC").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: safeZone }).format(date);
  } catch {
    safeZone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

export function adjacentMonthKey(monthKey, offset) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKeyInTimeZone();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(offset || 0), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
