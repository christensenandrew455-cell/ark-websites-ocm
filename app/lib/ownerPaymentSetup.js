import { FieldValue } from "firebase-admin/firestore";
import { ACCOUNT_ROLES, isStandardRole } from "./accountRoles";
import { ACCOUNT_TYPES } from "./accountTypes";
import { accountCollection, accountRef as regularAccountRef } from "./firestoreLayout.js";
import { deletePendingOwnerSignup, pendingOwnerSignupExpired, readPendingOwnerSignup } from "./pendingOwnerSignup";
import { pendingReferralFields } from "./referrals";
import { ensureCustomerBillingSubscription } from "./stripeUsageBilling";

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
    nextPath: "/",
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
  const temporaryAccount = temporary.account || temporary;
  const business = temporary.business || temporary;
  const payment = temporary.payment || {};
  const clientId = text(temporary.clientId);
  const accountRef = regularAccountRef(db, clientId);
  const storedCustomerId = text(payment.stripeCustomerId);
  if (temporary.identityVerificationVerified !== true || temporary.businessSetupComplete !== true || text(temporary.stage) !== "pending_payment" || !clientId || !storedCustomerId) throw new Error("PAYMENT_SETUP_FORBIDDEN");
  if (text(payment.stripeSetupIntentId) !== safeSetupIntentId) throw new Error("PAYMENT_SETUP_FORBIDDEN");

  const setupIntent = await stripe.setupIntents.retrieve(safeSetupIntentId, { expand: ["payment_method"] });
  if (setupIntent.status !== "succeeded") throw new Error("PAYMENT_SETUP_INCOMPLETE");
  if (customerId(setupIntent.customer) !== storedCustomerId) throw new Error("PAYMENT_SETUP_FORBIDDEN");
  if (text(setupIntent.metadata?.uid) !== safeUid || text(setupIntent.metadata?.clientId) !== clientId || text(setupIntent.metadata?.purpose) !== "ark_onboarding_payment_method") throw new Error("PAYMENT_SETUP_FORBIDDEN");

  const savedPaymentMethodId = paymentMethodId(setupIntent.payment_method);
  if (!savedPaymentMethodId) throw new Error("PAYMENT_METHOD_MISSING");
  const paymentMethod = typeof setupIntent.payment_method === "string" ? await stripe.paymentMethods.retrieve(savedPaymentMethodId) : setupIntent.payment_method;
  const paymentMethodLabel = savedPaymentMethodLabel(paymentMethod);
  const businessName = text(temporaryAccount.businessName || business.businessName || clientId);
  const ownerName = text(temporaryAccount.ownerName || business.ownerName);
  const accountEmail = text(temporaryAccount.accountEmail || business.businessEmail).toLowerCase();
  const accountPhone = text(temporaryAccount.accountPhone || business.businessPhone);
  const accountPhoneNormalized = text(temporaryAccount.accountPhoneNormalized || accountPhone);

  await stripe.customers.update(storedCustomerId, {
    email: accountEmail,
    name: ownerName,
    phone: accountPhone,
    invoice_settings: { default_payment_method: savedPaymentMethodId },
    metadata: { uid: safeUid, clientId, businessName, accountType: "owner", accountStatus: "active" },
  });
  const subscription = await ensureCustomerBillingSubscription({
    stripe,
    db,
    clientId,
    customerId: storedCustomerId,
    paymentMethodId: savedPaymentMethodId,
    businessName,
    uid: safeUid,
    subscriptionIdempotencyKey: `ark-base-subscription-${safeUid}`,
    persist: false,
    createIfMissing: true,
  });

  const now = FieldValue.serverTimestamp();
  const referralFields = pendingReferralFields(temporaryAccount.referral || temporary.referral);
  const businessProfile = {
    timeZone: text(business.timeZone || "America/New_York"),
    estimateDays: text(business.estimateDays),
    estimateWeekdays: Array.isArray(business.estimateWeekdays) ? business.estimateWeekdays : [],
    estimateStartHour: business.estimateStartHour || "",
    estimateStartPeriod: text(business.estimateStartPeriod),
    estimateEndHour: business.estimateEndHour || "",
    estimateEndPeriod: text(business.estimateEndPeriod),
    earliestEstimateStart: text(business.earliestEstimateStart),
    latestEstimateStart: text(business.latestEstimateStart),
    businessBase: text(business.businessBase),
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
    accountPhoneNormalized,
    businessSetupComplete: true,
    paymentSetupStatus: "complete",
    stripeCustomerId: storedCustomerId,
    stripeSetupIntentId: safeSetupIntentId,
    stripePaymentMethodId: savedPaymentMethodId,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    paymentMethodLabel,
    identityVerificationRequired: false,
    identityVerificationVerified: true,
    identityVerificationStatus: "verified",
    emailVerificationStatus: "verified",
    phoneVerificationStatus: text(temporary.phoneVerificationStatus || "verified"),
    identityVerifiedAt: temporary.identityVerifiedAt || now,
    usageBalancePoints: 0,
    usageSmsPartRemainder: 0,
    usageChargeStatus: "idle",
    billingPastDue: false,
    lastPaymentAt: now,
    numberAssignmentStatus: "needed",
    receptionistPhone: "",
    onboardingTourStatus: "pending",
    ...referralFields,
    activatedAt: now,
    paymentMethodSavedAt: now,
    updatedAt: now,
    createdAt: now,
  };
  const accountData = {
    ...shared,
    ...businessProfile,
    businessNameKey: clientId,
    accountType: ACCOUNT_TYPES.OWNER,
    businessRole: "owner",
    termsAccepted: temporaryAccount.termsAccepted === true,
    privacyAccepted: temporaryAccount.privacyAccepted === true,
    termsVersion: text(temporaryAccount.termsVersion),
    privacyVersion: text(temporaryAccount.privacyVersion),
    legalAcceptedAt: temporaryAccount.legalAcceptedAt || now,
    businessEmail: accountEmail,
    businessPhone: accountPhone,
    enabled: true,
    receptionistEnabled: true,
    connectionKey: "",
  };
  const batch = db.batch();
  batch.create(accountRef, accountData);
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
    identityVerificationRequired: false,
    identityVerificationVerified: true,
    termsAccepted: temporaryAccount.termsAccepted === true,
    privacyAccepted: temporaryAccount.privacyAccepted === true,
    termsVersion: text(temporaryAccount.termsVersion),
    privacyVersion: text(temporaryAccount.privacyVersion),
  });

  return {
    status: "succeeded",
    clientId,
    paymentMethodId: savedPaymentMethodId,
    paymentMethodLabel,
    nextPath: "/",
  };
}
