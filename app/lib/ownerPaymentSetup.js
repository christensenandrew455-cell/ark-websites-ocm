import { FieldValue } from "firebase-admin/firestore";
import { ACCOUNT_ROLES, isStandardRole } from "./accountRoles";
import { ACCOUNT_TYPES } from "./accountTypes";
import { newAccountVerificationDeadline } from "./accountVerificationDeadline";
import { sendAccountVerificationCodes } from "./accountVerification";
import { pendingOwnerSignupExpired, readPendingOwnerSignup } from "./pendingOwnerSignup";
import { pendingReferralFields } from "./referrals";
import { accountPhoneRegistryId } from "./signupAvailability";
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
    nextPath: account.identityVerificationVerified === true ? "/" : "/signup/verify",
  };
}

export async function completeOwnerPaymentSetup({ db, auth, stripe, uid, setupIntentId }) {
  const safeUid = text(uid);
  const safeSetupIntentId = text(setupIntentId);
  if (!safeUid || !safeSetupIntentId) throw new Error("PAYMENT_SETUP_MISSING");

  const accountRef = db.collection("accounts").doc(safeUid);
  const existingAccountSnapshot = await accountRef.get();
  if (existingAccountSnapshot.exists) {
    const existingAccount = existingAccountSnapshot.data();
    if (isStandardRole(existingAccount.role) && existingAccount.paymentSetupStatus === "complete" && text(existingAccount.stripeSetupIntentId) === safeSetupIntentId) {
      return completedResult(existingAccount, safeSetupIntentId);
    }
    throw new Error("PAYMENT_SETUP_FORBIDDEN");
  }

  const pending = await readPendingOwnerSignup({ db, uid: safeUid, allowExpired: true });
  if (!pending || pendingOwnerSignupExpired(pending.data)) throw new Error("PAYMENT_SETUP_EXPIRED");
  const temporary = pending.data;
  const temporaryAccount = temporary.account || {};
  const business = temporary.business || {};
  const payment = temporary.payment || {};
  const clientId = text(temporary.clientId);
  const storedCustomerId = text(payment.stripeCustomerId);
  if (temporary.businessSetupComplete !== true || text(temporary.stage) !== "pending_payment" || !clientId || !storedCustomerId) throw new Error("PAYMENT_SETUP_FORBIDDEN");
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
  const verificationDeadline = newAccountVerificationDeadline();
  const referralFields = pendingReferralFields(temporaryAccount.referral);
  const shared = {
    uid: safeUid,
    ownerUid: safeUid,
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
    identityVerificationRequired: true,
    identityVerificationVerified: false,
    identityVerificationStatus: "pending",
    emailVerificationStatus: "pending",
    phoneVerificationStatus: "pending",
    identityVerificationDeadlineAt: verificationDeadline,
    usageBalancePoints: 0,
    usageSmsPartRemainder: 0,
    usageChargeStatus: "idle",
    usageSuspended: false,
    billingPastDue: false,
    serviceAccess: "full",
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
    accountType: ACCOUNT_TYPES.OWNER,
    businessRole: "owner",
    termsAccepted: temporaryAccount.termsAccepted === true,
    privacyAccepted: temporaryAccount.privacyAccepted === true,
    termsVersion: text(temporaryAccount.termsVersion),
    privacyVersion: text(temporaryAccount.privacyVersion),
    legalAcceptedAt: temporaryAccount.legalAcceptedAt || now,
    businessProfile: business,
  };
  const receptionistData = {
    ...business,
    clientId,
    businessName,
    ownerName,
    businessEmail: accountEmail,
    businessPhone: accountPhone,
    businessSetupComplete: true,
    enabled: true,
    updatedAt: now,
    createdAt: now,
  };
  const clientRef = db.collection("ocmClients").doc(clientId);
  const batch = db.batch();
  batch.create(accountRef, accountData);
  batch.create(db.collection("businesses").doc(clientId), { ...shared, ...business, businessEmail: accountEmail, businessPhone: accountPhone });
  batch.create(clientRef, shared);
  batch.set(clientRef.collection("settings").doc("account"), {
    BusinessName: businessName,
    OwnerName: ownerName,
    AccountEmail: accountEmail,
    AccountPhone: accountPhone,
    PaymentSetupStatus: "Complete",
    PaymentMethodLabel: paymentMethodLabel,
    StripeCustomerId: storedCustomerId,
    StripeSetupIntentId: safeSetupIntentId,
    StripeSubscriptionId: subscription.id,
    StripeSubscriptionStatus: subscription.status,
    NumberAssignmentStatus: "Needed",
    updatedAt: now,
    createdAt: now,
  });
  batch.set(clientRef.collection("settings").doc("receptionist"), receptionistData);
  batch.set(db.collection("businessNameRegistry").doc(clientId), { clientId, businessName, ownerUid: safeUid, status: "active", expiresAt: FieldValue.delete(), updatedAt: now }, { merge: true });
  batch.set(db.collection("accountPhoneRegistry").doc(accountPhoneRegistryId(accountPhoneNormalized)), { uid: safeUid, ownerUid: safeUid, clientId, accountPhoneNormalized, status: "active", expiresAt: FieldValue.delete(), updatedAt: now }, { merge: true });
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
    identityVerificationRequired: true,
    identityVerificationVerified: false,
    termsAccepted: temporaryAccount.termsAccepted === true,
    privacyAccepted: temporaryAccount.privacyAccepted === true,
    termsVersion: text(temporaryAccount.termsVersion),
    privacyVersion: text(temporaryAccount.privacyVersion),
  });

  let verificationDeliveryStatus = "sent";
  try {
    await sendAccountVerificationCodes({ db, uid: safeUid, clientId, email: accountEmail, phone: accountPhone, ignoreCooldown: true });
  } catch (error) {
    verificationDeliveryStatus = "needs_resend";
    console.error("The regular account was created, but its verification codes need to be resent", error);
  }

  return {
    status: "succeeded",
    clientId,
    paymentMethodId: savedPaymentMethodId,
    paymentMethodLabel,
    verificationDeliveryStatus,
    nextPath: "/signup/verify",
  };
}
