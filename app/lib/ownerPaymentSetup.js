import { FieldValue } from "firebase-admin/firestore";
import { sendAdminEvent } from "./adminEvents.js";
import { ACCOUNT_ROLES, isStandardRole } from "./accountRoles";
import { ACCOUNT_TYPES } from "./accountTypes";
import { billingPlan, normalizeBillingPlanKey } from "./billingPricing.js";
import {
  accountBusinessRef,
  accountCollection,
  accountCustomizationRef,
  accountRef as regularAccountRef,
} from "./firestoreLayout.js";
import {
  deletePendingOwnerSignup,
  pendingOwnerSignupAccount,
  pendingOwnerSignupBusiness,
  pendingOwnerSignupExpired,
  pendingOwnerSignupLegal,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "./pendingOwnerSignup";
import { ensureCustomerBillingSubscription } from "./stripePlanBilling";

function text(value) { return String(value || "").trim(); }
function paymentMethodId(value) { return typeof value === "string" ? value : text(value?.id); }
function customerId(value) { return typeof value === "string" ? value : text(value?.id); }
function savedPaymentMethodLabel(paymentMethod) {
  if (!paymentMethod?.card) return "Payment method saved in Stripe";
  const brand = text(paymentMethod.card.brand || "Card");
  return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${text(paymentMethod.card.last4)}`;
}

function completedResult(account, setupIntentId) {
  return {
    status: "succeeded",
    clientId: text(account.clientId),
    setupIntentId,
    paymentMethodId: text(account.stripePaymentMethodId),
    paymentMethodLabel: text(account.paymentMethodLabel),
    nextPath: "/login",
  };
}

export async function completeOwnerPaymentSetup({ db, auth, stripe, uid, setupIntentId }) {
  const safeUid = text(uid);
  const safeSetupIntentId = text(setupIntentId);
  if (!safeUid || !safeSetupIntentId) throw new Error("PAYMENT_SETUP_MISSING");

  const existingAccounts = await accountCollection(db).where("uid", "==", safeUid).limit(1).get();
  if (!existingAccounts.empty) {
    const existingAccount = existingAccounts.docs[0].data();
    if (isStandardRole(existingAccount.role) && existingAccount.paymentSetupStatus === "complete" && text(existingAccount.stripeSetupIntentId) === safeSetupIntentId) {
      return completedResult(existingAccount, safeSetupIntentId);
    }
    throw new Error("PAYMENT_SETUP_FORBIDDEN");
  }

  const pending = await readPendingOwnerSignup({ db, uid: safeUid, allowExpired: true });
  if (!pending) throw new Error("PAYMENT_SETUP_EXPIRED");
  if (pendingOwnerSignupExpired(pending.data)) {
    await deletePendingOwnerSignup({ db, auth, uid: safeUid, pending });
    throw new Error("PAYMENT_SETUP_EXPIRED");
  }
  const temporary = pending.data;
  const temporaryAccount = pendingOwnerSignupAccount(temporary);
  const business = pendingOwnerSignupBusiness(temporary);
  const legal = pendingOwnerSignupLegal(temporary);
  const payment = temporary.payment || {};
  const planKey = normalizeBillingPlanKey(payment.billingPlanKey);
  const plan = billingPlan(planKey);
  const clientId = text(temporary.clientId);
  const accountRef = regularAccountRef(db, clientId);
  const businessRef = accountBusinessRef(db, clientId);
  const customizationRef = accountCustomizationRef(db, clientId);
  const storedCustomerId = text(payment.stripeCustomerId);
  if (!pendingOwnerSignupVerified(temporary) || text(temporary.stage) !== "pending_payment" || !clientId || !storedCustomerId) throw new Error("PAYMENT_SETUP_FORBIDDEN");
  if (text(payment.stripeSetupIntentId) !== safeSetupIntentId) throw new Error("PAYMENT_SETUP_FORBIDDEN");

  const setupIntent = await stripe.setupIntents.retrieve(safeSetupIntentId, { expand: ["payment_method"] });
  if (setupIntent.status !== "succeeded") throw new Error("PAYMENT_SETUP_INCOMPLETE");
  if (customerId(setupIntent.customer) !== storedCustomerId) throw new Error("PAYMENT_SETUP_FORBIDDEN");
  if (text(setupIntent.metadata?.uid) !== safeUid
    || text(setupIntent.metadata?.clientId) !== clientId
    || text(setupIntent.metadata?.purpose) !== "ark_onboarding_payment_method"
    || normalizeBillingPlanKey(setupIntent.metadata?.billingPlan) !== planKey) throw new Error("PAYMENT_SETUP_FORBIDDEN");

  const savedPaymentMethodId = paymentMethodId(setupIntent.payment_method);
  if (!savedPaymentMethodId) throw new Error("PAYMENT_METHOD_MISSING");
  const paymentMethod = typeof setupIntent.payment_method === "string" ? await stripe.paymentMethods.retrieve(savedPaymentMethodId) : setupIntent.payment_method;
  const paymentMethodLabel = savedPaymentMethodLabel(paymentMethod);
  const businessName = text(temporaryAccount.businessName || business.businessName || clientId);
  const ownerName = text(temporaryAccount.ownerName || business.ownerName);
  const accountEmail = text(temporaryAccount.accountEmail || business.businessEmail).toLowerCase();
  const accountPhone = text(temporaryAccount.accountPhone || business.businessPhone);

  await stripe.customers.update(storedCustomerId, {
    email: accountEmail,
    name: ownerName,
    phone: accountPhone,
    invoice_settings: { default_payment_method: savedPaymentMethodId },
    metadata: { uid: safeUid, clientId, businessName, accountType: "owner", accountStatus: "active", billingPlan: planKey },
  });
  const subscriptionResult = await ensureCustomerBillingSubscription({
    stripe,
    db,
    clientId,
    customerId: storedCustomerId,
    paymentMethodId: savedPaymentMethodId,
    businessName,
    uid: safeUid,
    planKey,
    timeZone: text(business.timeZone || "America/New_York"),
    subscriptionIdempotencyKey: `ark-plan-subscription-${safeUid}-${planKey}`,
    persist: false,
    createIfMissing: true,
  });
  const subscription = subscriptionResult.subscription;

  const now = FieldValue.serverTimestamp();
  const businessProfile = {
    businessName,
    businessEmail: accountEmail,
    businessPhone: accountPhone,
    timeZone: text(business.timeZone || "America/New_York"),
    estimateWeekdays: Array.isArray(business.estimateWeekdays) ? business.estimateWeekdays : [],
    earliestEstimateStart: text(business.earliestEstimateStart),
    latestEstimateStart: text(business.latestEstimateStart),
    businessType: text(business.businessType || business.businessBase),
    serviceAreas: Array.isArray(business.serviceAreas) ? business.serviceAreas : [],
    services: business.services && typeof business.services === "object" && !Array.isArray(business.services) ? business.services : {},
    businessInformation: Array.isArray(business.businessInformation) ? business.businessInformation : [],
    extraInformation: text(business.extraInformation),
  };
  const shared = {
    uid: safeUid,
    clientId,
    role: ACCOUNT_ROLES.STANDARD,
    status: "active",
    businessName,
    ownerName,
    accountEmail,
    accountPhone,
    businessSetupComplete: true,
    paymentSetupStatus: "complete",
    billingProvider: "stripe",
    stripeCustomerId: storedCustomerId,
    stripeSetupIntentId: safeSetupIntentId,
    stripePaymentMethodId: savedPaymentMethodId,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    ...subscriptionResult.accountFields,
    paymentMethodLabel,
    identityVerificationVerified: true,
    billingPlanKey: planKey,
    billingPlanName: plan.name,
    monthlyPlanAmountCents: plan.amountCents,
    monthlyCallLimit: plan.monthlyCalls,
    callPeriodKey: "",
    callsUsedThisPeriod: 0,
    callsRemainingThisPeriod: plan.monthlyCalls,
    callLimitReached: false,
    billingPastDue: false,
    lastPaymentAt: now,
    numberAssignmentStatus: "needed",
    receptionistPhone: "",
    activatedAt: now,
    paymentMethodSavedAt: now,
    updatedAt: now,
    createdAt: now,
  };
  const customization = {
    darkMode: false,
    messagesEnabled: false,
    leadRetentionDays: 0,
    clientRetentionDays: 0,
    messageRetentionDays: 0,
    clientStatusNoticeEnabled: true,
    onboardingTourEligible: true,
    onboardingTourStatus: "pending",
    onboardingGuideVersion: 2,
    onboardingGuideSeen: { dashboard: false, settings: false, leads: false },
    onboardingNumberGuidePhone: "",
    nativeSetupPromptStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const accountData = {
    ...shared,
    accountType: ACCOUNT_TYPES.OWNER,
    businessRole: "owner",
    termsAccepted: legal.termsAccepted === true,
    privacyAccepted: legal.privacyAccepted === true,
    termsVersion: text(legal.termsVersion),
    privacyVersion: text(legal.privacyVersion),
    legalAcceptedAt: legal.acceptedAt || now,
    enabled: true,
    receptionistEnabled: true,
    connectionKey: "",
  };
  const batch = db.batch();
  batch.create(accountRef, accountData);
  batch.create(businessRef, { ...businessProfile, createdAt: now, updatedAt: now });
  batch.create(customizationRef, customization);
  batch.delete(pending.ref);
  await batch.commit();

  const userRecord = await auth.getUser(safeUid);
  await auth.setCustomUserClaims(safeUid, {
    ...(userRecord.customClaims || {}),
    role: ACCOUNT_ROLES.STANDARD,
    accountType: ACCOUNT_TYPES.OWNER,
    businessRole: "owner",
    clientId,
    accountStatus: "active",
    temporaryAccount: false,
    signupVerification: false,
    identityVerificationRequired: false,
    identityVerificationVerified: true,
    termsAccepted: legal.termsAccepted === true,
    privacyAccepted: legal.privacyAccepted === true,
    termsVersion: text(legal.termsVersion),
    privacyVersion: text(legal.privacyVersion),
  });
  await sendAdminEvent({
    id: `account-activated-${clientId}-${safeSetupIntentId}`,
    type: "account.activated",
    clientId,
    businessName,
    summary: "Customer finished signup and needs a receptionist number",
    metadata: { numberAssignmentStatus: "needed", billingPlan: planKey, monthlyCalls: plan.monthlyCalls },
  });

  return {
    status: "succeeded",
    clientId,
    paymentMethodId: savedPaymentMethodId,
    paymentMethodLabel,
    nextPath: "/login",
  };
}
