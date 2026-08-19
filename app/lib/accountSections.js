const BUSINESS_FIELDS = Object.freeze([
  "businessName",
  "businessEmail",
  "businessPhone",
  "timeZone",
  "estimateWeekdays",
  "earliestEstimateStart",
  "latestEstimateStart",
  "businessType",
  "serviceAreas",
  "services",
  "businessInformation",
  "extraInformation",
]);

const CUSTOMIZATION_FIELDS = Object.freeze([
  "darkMode",
  "messagesEnabled",
  "leadRetentionDays",
  "clientRetentionDays",
  "messageRetentionDays",
  "clientStatusNoticeEnabled",
  "clientDeclineNoticeEnabled",
  "onboardingTourEligible",
  "onboardingTourStatus",
  "onboardingTourStartedAt",
  "onboardingTourFinishedAt",
  "onboardingGuideVersion",
  "onboardingGuideSeen",
  "onboardingGuideUpdatedAt",
  "onboardingNumberGuidePhone",
  "onboardingNumberGuideSeenAt",
  "nativeSetupPromptStatus",
  "nativeSetupPromptedAt",
  "nativeSetupFinishedAt",
  "helpSelfServiceLastUsedAt",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pick(source, fields) {
  const value = object(source);
  return Object.fromEntries(fields.flatMap((field) => Object.hasOwn(value, field) ? [[field, value[field]]] : []));
}

export function businessSectionData(source = {}) {
  return pick(source, BUSINESS_FIELDS);
}

export function customizationSectionData(source = {}) {
  return pick(source, CUSTOMIZATION_FIELDS);
}

export function businessRootFieldDeletes(deleteValue) {
  return Object.fromEntries(BUSINESS_FIELDS
    .filter((field) => field !== "businessName")
    .map((field) => [field, deleteValue]));
}

export function customizationRootFieldDeletes(deleteValue) {
  return Object.fromEntries(CUSTOMIZATION_FIELDS.map((field) => [field, deleteValue]));
}

export async function readAccountSections(accountSnapshot) {
  if (!accountSnapshot?.exists) return null;
  const account = object(accountSnapshot.data());
  const businessRef = accountSnapshot.ref.collection("business").doc("profile");
  const customizationRef = accountSnapshot.ref.collection("customization").doc("preferences");
  const [businessSnapshot, customizationSnapshot] = await Promise.all([
    businessRef.get(),
    customizationRef.get(),
  ]);
  const business = {
    ...businessSectionData(account),
    ...businessSectionData(businessSnapshot.exists ? businessSnapshot.data() : {}),
  };
  const customization = {
    ...customizationSectionData(account),
    ...customizationSectionData(customizationSnapshot.exists ? customizationSnapshot.data() : {}),
  };
  return {
    account,
    business,
    customization,
    combined: { ...account, ...business, ...customization },
    accountRef: accountSnapshot.ref,
    businessRef,
    customizationRef,
  };
}
