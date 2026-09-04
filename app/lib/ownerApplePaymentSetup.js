import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { sendAdminEvent } from "./adminEvents.js";
import { ACCOUNT_ROLES, isStandardRole } from "./accountRoles.js";
import { ACCOUNT_TYPES } from "./accountTypes.js";
import { applePlanForProduct } from "./appleIapCatalog.js";
import { sameAppleAccountToken } from "./appleIapRequest.js";
import {
  accountBusinessRef,
  accountCollection,
  accountCustomizationRef,
  accountRef as regularAccountRef,
  systemCollection,
} from "./firestoreLayout.js";
import {
  pendingOwnerSignupAccount,
  pendingOwnerSignupBusiness,
  pendingOwnerSignupExpired,
  pendingOwnerSignupLegal,
  pendingOwnerSignupPersonalization,
  pendingOwnerSignupReferral,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "./pendingOwnerSignup.js";
import { normalizeNotificationPreferences } from "./notificationPreferences.js";
import { completeReferralReward, referralOfferExpiration } from "./referralRewards.js";
import { reportRevenuePayment } from "./revenueLedger.js";

function text(value) { return String(value || "").trim(); }
function completedResult(account, transactionId) {
  return {
    status: "succeeded",
    clientId: text(account.clientId),
    transactionId,
    paymentMethodLabel: text(account.paymentMethodLabel || "Apple In-App Purchase"),
    nextPath: "/login",
  };
}

export async function completeOwnerApplePaymentSetup({ db, auth, uid, transaction }) {
  const safeUid = text(uid);
  const transactionId = text(transaction?.transactionId);
  const originalTransactionId = text(transaction?.originalTransactionId);
  const expiresAt = Number(transaction?.expiresDate || 0);
  const purchasedAt = Number(transaction?.purchaseDate || 0) || Date.now();
  const purchasedPlan = applePlanForProduct(transaction?.productId);
  if (!safeUid || !transactionId || !originalTransactionId) throw new Error("APPLE_PAYMENT_SETUP_MISSING");
  if (!purchasedPlan
    || text(transaction.type) !== "Auto-Renewable Subscription"
    || transaction.revocationDate
    || expiresAt <= Date.now()) throw new Error("APPLE_SUBSCRIPTION_INACTIVE");
  const amountCents = Number(transaction?.price || 0) > 0 ? Math.round(Number(transaction.price) / 10) : purchasedPlan.amountCents;
  const currency = text(transaction?.currency || "usd").toLowerCase();

  const existingAccounts = await accountCollection(db).where("uid", "==", safeUid).limit(1).get();
  if (!existingAccounts.empty) {
    const existingAccount = existingAccounts.docs[0].data();
    if (isStandardRole(existingAccount.role)
      && existingAccount.paymentSetupStatus === "complete"
      && existingAccount.billingProvider === "apple"
      && (text(existingAccount.appleOriginalTransactionId) === originalTransactionId
        || text(existingAccount.appleSubscriptionTransactionId) === transactionId)) {
      if (text(existingAccount.referredByClientId)) {
        await completeReferralReward({ db, referredClientId: existingAccount.clientId, referralCode: existingAccount.referredByClientId }).catch((error) => {
          console.error("Unable to retry the signup referral reward", error);
        });
      }
      await reportRevenuePayment({
        db,
        eventId: `billing-paid-apple-${transactionId}`,
        provider: "apple",
        paymentId: transactionId,
        paymentKind: "subscription",
        clientId: existingAccount.clientId,
        businessName: text(existingAccount.businessName || existingAccount.clientId),
        amountCents,
        currency,
        paidAt: purchasedAt,
        summary: `${purchasedPlan.name} monthly payment succeeded`,
        metadata: {
          billingPlan: purchasedPlan.key,
          monthlyAcceptedLeads: purchasedPlan.monthlyAcceptedLeads,
          monthlyCalls: purchasedPlan.monthlyCalls,
        },
      });
      return completedResult(existingAccount, transactionId);
    }
    throw new Error("APPLE_PAYMENT_SETUP_FORBIDDEN");
  }

  const pending = await readPendingOwnerSignup({ db, uid: safeUid, allowExpired: true });
  if (!pending || pendingOwnerSignupExpired(pending.data)) throw new Error("APPLE_PAYMENT_SETUP_EXPIRED");
  const temporary = pending.data;
  const temporaryAccount = pendingOwnerSignupAccount(temporary);
  const business = pendingOwnerSignupBusiness(temporary);
  const legal = pendingOwnerSignupLegal(temporary);
  const personalization = normalizeNotificationPreferences(pendingOwnerSignupPersonalization(temporary), temporaryAccount);
  const referralCode = text(pendingOwnerSignupReferral(temporary).code);
  const payment = temporary.payment || {};
  const clientId = text(temporary.clientId);
  if (!pendingOwnerSignupVerified(temporary)
    || text(temporary.stage) !== "pending_payment"
    || !clientId
    || !sameAppleAccountToken(payment.appleAppAccountToken, transaction.appAccountToken)) {
    throw new Error("APPLE_PAYMENT_SETUP_FORBIDDEN");
  }

  const accountRef = regularAccountRef(db, clientId);
  const businessRef = accountBusinessRef(db, clientId);
  const customizationRef = accountCustomizationRef(db, clientId);
  const transactionRef = systemCollection(db, "appleTransactions").doc(transactionId);
  const businessName = text(temporaryAccount.businessName || business.businessName || clientId);
  const ownerName = text(temporaryAccount.ownerName || business.ownerName);
  const accountEmail = text(temporaryAccount.accountEmail || business.businessEmail).toLowerCase();
  const accountPhone = text(temporaryAccount.accountPhone || business.businessPhone);
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
    billingProvider: "apple",
    appleAppAccountToken: text(payment.appleAppAccountToken).toLowerCase(),
    appleSubscriptionProductId: purchasedPlan.productId,
    appleOriginalTransactionId: originalTransactionId,
    appleSubscriptionTransactionId: transactionId,
    appleSubscriptionStatus: "active",
    appleSubscriptionEnvironment: text(transaction.environment),
    appleSubscriptionExpiresAt: Timestamp.fromMillis(expiresAt),
    paymentMethodLabel: "Apple In-App Purchase",
    identityVerificationVerified: true,
    billingPlanKey: purchasedPlan.key,
    billingPlanName: purchasedPlan.name,
    monthlyPlanAmountCents: purchasedPlan.amountCents,
    monthlyAcceptedLeadLimit: purchasedPlan.monthlyAcceptedLeads,
    acceptedLeadPeriodLimit: purchasedPlan.monthlyAcceptedLeads,
    acceptedLeadPeriodStartAt: Timestamp.fromMillis(purchasedAt),
    acceptedLeadPeriodEndAt: Timestamp.fromMillis(expiresAt),
    acceptedLeadPeriodKey: "",
    acceptedLeadsUsedThisPeriod: 0,
    acceptedLeadsRemainingThisPeriod: purchasedPlan.monthlyAcceptedLeads,
    acceptedLeadTopUpPeriodKey: "",
    acceptedLeadTopUpsThisPeriod: 0,
    acceptedLeadLimitReached: false,
    monthlyCallLimit: purchasedPlan.monthlyCalls,
    callPeriodStartAt: Timestamp.fromMillis(purchasedAt),
    callPeriodEndAt: Timestamp.fromMillis(expiresAt),
    callPeriodKey: "",
    callsUsedThisPeriod: 0,
    callsRemainingThisPeriod: purchasedPlan.monthlyCalls,
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
  batch.create(transactionRef, {
    provider: "apple",
    kind: "subscription",
    clientId,
    uid: safeUid,
    businessName,
    productId: purchasedPlan.productId,
    billingPlanKey: purchasedPlan.key,
    amountCents,
    currency,
    monthlyAcceptedLeads: purchasedPlan.monthlyAcceptedLeads,
    monthlyCalls: purchasedPlan.monthlyCalls,
    originalTransactionId,
    appAccountToken: text(payment.appleAppAccountToken).toLowerCase(),
    environment: text(transaction.environment),
    purchaseDate: Timestamp.fromMillis(purchasedAt),
    expiresAt: Timestamp.fromMillis(expiresAt),
    createdAt: now,
  });
  batch.delete(pending.ref);
  await batch.commit();

  if (referralCode) {
    await completeReferralReward({ db, referredClientId: clientId, referralCode }).catch((error) => {
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
    id: `account-activated-${clientId}-${transactionId}`,
    type: "account.activated",
    clientId,
    businessName,
    summary: "Customer finished signup and needs a receptionist number",
    metadata: { numberAssignmentStatus: "needed", billingProvider: "apple", billingPlan: purchasedPlan.key, monthlyAcceptedLeads: purchasedPlan.monthlyAcceptedLeads, monthlyCalls: purchasedPlan.monthlyCalls },
  });
  await reportRevenuePayment({
    db,
    eventId: `billing-paid-apple-${transactionId}`,
    provider: "apple",
    paymentId: transactionId,
    paymentKind: "subscription",
    clientId,
    businessName,
    amountCents,
    currency,
    paidAt: purchasedAt,
    summary: `${purchasedPlan.name} monthly payment succeeded`,
    metadata: {
      billingPlan: purchasedPlan.key,
      monthlyAcceptedLeads: purchasedPlan.monthlyAcceptedLeads,
      monthlyCalls: purchasedPlan.monthlyCalls,
    },
  });
  return completedResult(accountData, transactionId);
}
