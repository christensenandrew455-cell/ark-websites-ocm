import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
  pendingOwnerSignupPersonalization,
  pendingOwnerSignupReferral,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "./pendingOwnerSignup";
import { normalizeNotificationPreferences } from "./notificationPreferences.js";
import { completeReferralReward, referralOfferExpiration } from "./referralRewards.js";
import { ensureCustomerBillingSubscription } from "./stripePlanBilling";
import { billingPromotion, promotionBillingFields } from "./temporaryFeatures.js";

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
      if (text(existingAccount.referredByClientId)) {
        await completeReferralReward({ db, stripe, referredClientId: existingAccount.clientId, referralCode: existingAccount.referredByClientId }).catch((error) => {
          console.error("Unable to retry the signup referral reward", error);
        });
      }
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
  const personalization = normalizeNotificationPreferences(pendingOwnerSignupPersonalization(temporary), temporaryAccount);
  const referralCode = text(pendingOwnerSignupReferral(temporary).code);
  const payment = temporary.payment || {};
  const planKey = normalizeBillingPlanKey(payment.billingPlanKey);
  const plan = billingPlan(planKey);
  const promotion = billingPromotion(payment.billingPromotionKey);
  if (text(payment.billingPromotionKey) && !promotion) throw new Error("PAYMENT_SETUP_FORBIDDEN");
  const discountFields = promotionBillingFields(plan, promotion);
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
    || normalizeBillingPlanKey(setupIntent.metadata?.billingPlan) !== planKey
    || text(setupIntent.metadata?.billingPromotion) !== (promotion?.key || "")) throw new Error("PAYMENT_SETUP_FORBIDDEN");

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
    metadata: {
      uid: safeUid,
      clientId,
      businessName,
      accountType: "owner",
      accountStatus: "active",
      billingPlan: planKey,
      billingPromotion: promotion?.key || "",
      billingDiscountPercent: promotion ? String(promotion.percentOff) : "",
      billingSalesChannel: promotion ? "web" : "",
    },
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
    promotionKey: promotion?.key || "",
    timeZone: text(business.timeZone || "America/New_York"),
    subscriptionIdempotencyKey: `ark-plan-subscription-${safeUid}-${planKey}-${promotion?.key || "regular"}`,
    persist: false,
    createIfMissing: true,
  });
  const subscription = subscriptionResult.subscription;

  const now = FieldValue.serverTimestamp();
  const referralOfferExpiresAt = Timestamp.fromDate(referralOfferExpiration());
  const businessProfile = {
    businessName,
    businessEmail: accountEmail,
    businessPhone: accountPhone,
    timeZone: text(business.timeZone || "America/New_York"),
    estimateWeekdays: Array.isArray(business.estimateWeekdays) ? business.estimateWeekdays : [],
    earliestEstimateStart: text(business.earliestEstimateStart),
    latestEstimateStart: text(business.latestEstimateStart),
    regularServiceEveryDay: business.regularServiceEveryDay === true,
    regularService24Hours: business.regularService24Hours === true,
    emergencyServiceEnabled: business.emergencyServiceEnabled === true,
    emergencyService24Hours: business.emergencyService24Hours === true,
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
    ...discountFields,
    monthlyAcceptedLeadLimit: plan.monthlyAcceptedLeads,
    acceptedLeadPeriodLimit: plan.monthlyAcceptedLeads,
    acceptedLeadPeriodKey: "",
    acceptedLeadsUsedThisPeriod: 0,
    acceptedLeadsRemainingThisPeriod: plan.monthlyAcceptedLeads,
    acceptedLeadTopUpPeriodKey: "",
    acceptedLeadTopUpsThisPeriod: 0,
    acceptedLeadLimitReached: false,
    monthlyCallLimit: plan.monthlyCalls,
    callPeriodKey: "",
    callsUsedThisPeriod: 0,
    callsRemainingThisPeriod: plan.monthlyCalls,
    callLimitReached: false,
    billingPastDue: false,
    referralFreeMonthsEarned: 0,
    referralFreeMonthsPending: 0,
    referralOfferExpiresAt,
    ...(referralCode ? { referredByClientId: referralCode } : {}),
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
    notificationChannels: personalization.notificationChannels,
    notificationEmail: personalization.notificationEmail,
    notificationPhone: personalization.notificationPhone,
    notificationPreferencesCompleted: personalization.notificationPreferencesCompleted === true,
    notificationSmsConsentAt: pendingOwnerSignupPersonalization(temporary).notificationSmsConsentAt || null,
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

  if (referralCode) {
    await completeReferralReward({ db, stripe, referredClientId: clientId, referralCode }).catch((error) => {
      console.error("Unable to apply the signup referral reward", error);
    });
  }

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
    metadata: {
      numberAssignmentStatus: "needed",
      billingPlan: planKey,
      monthlyAcceptedLeads: plan.monthlyAcceptedLeads,
      monthlyCalls: plan.monthlyCalls,
      billingPromotion: promotion?.key || "",
      billingDiscountPercent: promotion?.percentOff || 0,
    },
  });

  return {
    status: "succeeded",
    clientId,
    paymentMethodId: savedPaymentMethodId,
    paymentMethodLabel,
    nextPath: "/login",
  };
}
