import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ACCOUNT_TYPES, DEFAULT_EMPLOYEE_VISIBILITY, normalizePersonKey } from "../../../lib/accountTypes";
import { sendAccountVerificationCodes } from "../../../lib/accountVerification";
import { newAccountVerificationDeadline } from "../../../lib/accountVerificationDeadline";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PHONE_VERIFICATION_REQUIRED } from "../../../lib/launchFeatures";
import { normalizeOwnerSignup, validateOwnerSignup } from "../../../lib/ownerSignup";
import { ownerSignupDigestMatches, ownerSignupUid } from "../../../lib/ownerSignupServer";
import { deletePendingOwnerSignup, loadPendingOwnerSignup, pendingOwnerSignupHandoffHash, pendingOwnerSignupHandoffMatches } from "../../../lib/pendingOwnerSignup";
import { pendingReferralFields, qualifyReferralAfterActivation, validateReferrerAccount } from "../../../lib/referrals";
import { accountPhoneRegistryId, checkSignupAvailability, normalizeSignupPhone } from "../../../lib/signupAvailability";
import {
  BILLING_VERSION,
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CALL_CENTS,
  PER_CHAT_CENTS,
  PER_EMPLOYEE_CENTS,
  PER_LEAD_CENTS,
  PER_MESSAGE_BUNDLE_CENTS,
  ensureCustomerBillingSubscription,
} from "../../../lib/stripeUsageBilling";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

function signupError(error) {
  const code = text(error?.code || error?.errorInfo?.code);
  const message = text(error?.message || error?.errorInfo?.message);
  if (code === "auth/email-already-exists" || message === "EMAIL_TAKEN") return { status: 409, message: "That email address is already registered." };
  if (message === "PHONE_TAKEN") return { status: 409, message: "That phone number is already registered." };
  if (message === "BUSINESS_TAKEN") return { status: 409, message: "That business name is already registered. Use a different business name." };
  if (message === "SELF_REFERRAL") return { status: 400, message: "A business cannot refer its own account." };
  if (message === "REFERRER_NOT_FOUND") return { status: 400, message: "That referral account ID is not an active ARK account." };
  if (message === "SIGNUP_HANDOFF_INVALID") return { status: 403, message: "That secure signup return link is not valid." };
  return { status: 500, message: "Unable to finish account setup right now." };
}

function compatibleReservation(snapshot, sessionId, uid) {
  if (!snapshot?.exists) return true;
  const data = snapshot.data();
  return text(data.signupSessionId) === sessionId || text(data.ownerUid || data.uid) === uid;
}

async function existingCompletion({ auth, db, receiptRef, handoff, rawSignup }) {
  const receiptSnapshot = await receiptRef.get();
  if (!receiptSnapshot.exists) return null;
  const receipt = receiptSnapshot.data();
  if (text(receipt.handoffHash)) {
    if (!handoff || !pendingOwnerSignupHandoffMatches(handoff, receipt.handoffHash)) return { response: NextResponse.json({ error: "That secure signup return link is not valid." }, { status: 403 }) };
  } else if (!rawSignup || !ownerSignupDigestMatches(rawSignup, receipt.signupDigest)) {
    return { response: NextResponse.json({ error: "That payment session belongs to a different signup." }, { status: 403 }) };
  }
  const uid = text(receipt.uid);
  const accountSnapshot = uid ? await db.collection("accounts").doc(uid).get() : null;
  if (!uid || !accountSnapshot?.exists) return null;
  const account = accountSnapshot.data();
  return {
    response: NextResponse.json({
      email: text(account.accountEmail),
      clientId: text(account.clientId),
      token: await auth.createCustomToken(uid),
      status: text(account.status),
      verificationRequired: account.identityVerificationRequired === true,
      completed: true,
    }),
  };
}

export async function POST(request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Unable to finish account setup right now." }, { status: 500 });
    const { sessionId: rawSessionId, handoff: rawHandoff, signup: rawSignup } = await request.json().catch(() => ({}));
    const sessionId = text(rawSessionId);
    const handoff = text(rawHandoff);
    if (!sessionId) return NextResponse.json({ error: "The payment session is missing." }, { status: 400 });

    const db = getAdminDb();
    const auth = getAdminAuth();
    const receiptRef = db.collection("signupSessions").doc(sessionId);
    const completed = await existingCompletion({ auth, db, receiptRef, handoff, rawSignup });
    if (completed) return completed.response;

    let pending = null;
    if (handoff) pending = await loadPendingOwnerSignup({ db, sessionId, handoff });
    const signupSource = pending?.signup || rawSignup;
    if (!signupSource) return NextResponse.json({ error: "Your secure signup details could not be recovered. Return to signup and try again." }, { status: 410 });
    const signup = normalizeOwnerSignup(signupSource, { includePassword: true });
    const validationError = validateOwnerSignup(signup);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    const metadata = session.metadata || {};
    const clientId = normalizeClientId(signup.businessName);
    const digest = text(metadata.signupDigest);
    if (text(metadata.signupFlow) !== "payment-gated-v2" || text(metadata.clientId) !== clientId || !ownerSignupDigestMatches(signup, digest)) {
      return NextResponse.json({ error: "That payment session does not match this signup." }, { status: 403 });
    }

    const setupIntent = session.setup_intent;
    const setupIntentStatus = typeof setupIntent === "string" ? "" : text(setupIntent?.status);
    if (session.mode !== "setup" || session.status !== "complete" || !setupIntent || setupIntentStatus !== "succeeded") {
      return NextResponse.json({ error: "The payment method has not been confirmed yet." }, { status: 402 });
    }
    const customerId = typeof session.customer === "string" ? session.customer : text(session.customer?.id);
    const setupIntentId = typeof setupIntent === "string" ? "" : text(setupIntent.id);
    const paymentMethodId = typeof setupIntent === "string" ? "" : typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : text(setupIntent.payment_method?.id);
    if (!customerId || !paymentMethodId || (pending?.stripeCustomerId && pending.stripeCustomerId !== customerId)) return NextResponse.json({ error: "The saved payment method could not be confirmed." }, { status: 402 });

    const uid = ownerSignupUid(sessionId);
    const accountPhoneNormalized = normalizeSignupPhone(signup.accountPhone);
    const accountRef = db.collection("accounts").doc(uid);
    const businessRef = db.collection("businesses").doc(clientId);
    const registryRef = db.collection("businessNameRegistry").doc(clientId);
    const phoneRegistryRef = db.collection("accountPhoneRegistry").doc(accountPhoneRegistryId(accountPhoneNormalized));
    const [businessSnapshot, registrySnapshot, availability, userByUid] = await Promise.all([
      businessRef.get(),
      registryRef.get(),
      checkSignupAvailability({ auth, db, businessName: signup.businessName, accountEmail: signup.accountEmail, accountPhone: signup.accountPhone, allowedUid: uid }),
      auth.getUser(uid).catch(() => null),
    ]);
    if (!compatibleReservation(businessSnapshot, sessionId, uid) || !compatibleReservation(registrySnapshot, sessionId, uid)) throw new Error("BUSINESS_TAKEN");
    if (availability.businessNameInUse) throw new Error("BUSINESS_TAKEN");
    if (availability.emailInUse) throw new Error("EMAIL_TAKEN");
    if (availability.phoneInUse) throw new Error("PHONE_TAKEN");
    if (userByUid && text(userByUid.email).toLowerCase() !== signup.accountEmail) throw new Error("EMAIL_TAKEN");

    const referrer = await validateReferrerAccount({ db, referrerAccountId: signup.referrerAccountId, referredClientId: clientId });
    if (!userByUid) {
      try {
        await auth.createUser({ uid, email: signup.accountEmail, password: signup.password, displayName: signup.ownerName, emailVerified: false, disabled: false });
      } catch (error) {
        if (!new Set(["auth/uid-already-exists", "auth/email-already-exists"]).has(text(error?.code))) throw error;
        const recovered = await auth.getUser(uid).catch(() => null);
        if (!recovered || text(recovered.email).toLowerCase() !== signup.accountEmail) throw error;
      }
    }

    await db.runTransaction(async (transaction) => {
      const [business, registry, phoneRegistry] = await Promise.all([transaction.get(businessRef), transaction.get(registryRef), transaction.get(phoneRegistryRef)]);
      if (!compatibleReservation(business, sessionId, uid) || !compatibleReservation(registry, sessionId, uid)) throw new Error("BUSINESS_TAKEN");
      if (!compatibleReservation(phoneRegistry, sessionId, uid)) throw new Error("PHONE_TAKEN");
      const reservation = {
        uid,
        ownerUid: uid,
        clientId,
        businessName: signup.businessName,
        businessNameKey: clientId,
        ownerName: signup.ownerName,
        accountEmail: signup.accountEmail,
        accountPhone: signup.accountPhone,
        accountPhoneNormalized,
        signupSessionId: sessionId,
        status: "activating",
        paymentSetupStatus: "complete",
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.set(accountRef, reservation, { merge: true });
      transaction.set(businessRef, reservation, { merge: true });
      transaction.set(registryRef, { clientId, businessName: signup.businessName, ownerUid: uid, signupSessionId: sessionId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(phoneRegistryRef, { uid, ownerUid: uid, clientId, accountPhoneNormalized, signupSessionId: sessionId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    let paymentMethodLabel = "Card saved in Stripe";
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
    if (paymentMethod?.card) {
      const brand = text(paymentMethod.card.brand || "Card");
      paymentMethodLabel = `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${paymentMethod.card.last4}`;
    }
    const subscription = await ensureCustomerBillingSubscription({
      stripe,
      db,
      clientId,
      customerId,
      paymentMethodId,
      businessName: signup.businessName,
      uid,
      existingSubscriptionId: "",
      subscriptionIdempotencyKey: `ark-owner-signup-subscription-${sessionId}`,
      persist: false,
    });
    if (subscription.status !== "active") return NextResponse.json({ error: "The first account payment was not completed." }, { status: 402 });

    const messagesEnabled = false;
    const employeesEnabled = false;
    const employeeMessagingEnabled = false;
    const acceptedAt = new Date();
    const identityVerificationDeadlineAt = newAccountVerificationDeadline();
    const verificationFields = {
      verificationStatus: "pending",
      identityVerificationRequired: true,
      identityVerificationVerified: false,
      identityVerificationStatus: "pending",
      identityVerificationDeadlineAt,
      emailVerificationStatus: "pending",
      phoneVerificationStatus: PHONE_VERIFICATION_REQUIRED ? "pending" : "not_required",
    };
    const billingFields = {
      billingPlan: "standard",
      billingPlanName: "ARK AI Receptionist",
      billingVersion: BILLING_VERSION,
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      includedLeads: 0,
      includedConversations: 0,
      includedEmployees: 0,
      perLeadCents: PER_LEAD_CENTS,
      perCallCents: PER_CALL_CENTS,
      perChatCents: PER_CHAT_CENTS,
      perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
      messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
      perEmployeeCents: PER_EMPLOYEE_CENTS,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
    };
    const activeFields = {
      status: "active",
      paymentSetupStatus: "complete",
      businessSetupComplete: true,
      numberAssignmentStatus: "needed",
      receptionistPhone: "",
      onboardingTourStatus: "pending",
      activatedAt: FieldValue.serverTimestamp(),
      submittedForNumberAt: FieldValue.serverTimestamp(),
      ...verificationFields,
      ...billingFields,
    };
    const accountData = {
      uid,
      ownerUid: uid,
      clientId,
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      businessName: signup.businessName,
      businessNameKey: clientId,
      ownerName: signup.ownerName,
      ownerNameKey: normalizePersonKey(signup.ownerName),
      accountEmail: signup.accountEmail,
      accountPhone: signup.accountPhone,
      accountPhoneNormalized,
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      employeeVisibility: DEFAULT_EMPLOYEE_VISIBILITY,
      ...pendingReferralFields(referrer),
      ...activeFields,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
      legalAcceptedAt: acceptedAt,
      legalAcceptedBy: signup.accountEmail,
      legalAcceptanceSource: "owner-signup-payment",
      legalRecordedAt: FieldValue.serverTimestamp(),
      signupSessionId: sessionId,
      stripeCustomerId: customerId,
      stripeSetupIntentId: setupIntentId,
      stripePaymentMethodId: paymentMethodId,
      stripeCheckoutSessionId: sessionId,
      paymentMethodLabel,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const clientRef = db.collection("ocmClients").doc(clientId);
    const accountSettingsRef = clientRef.collection("settings").doc("account");
    const receptionistSettingsRef = clientRef.collection("settings").doc("receptionist");
    const batch = db.batch();
    batch.set(accountRef, accountData, { merge: true });
    batch.set(businessRef, accountData, { merge: true });
    batch.set(registryRef, { clientId, businessName: signup.businessName, ownerUid: uid, signupSessionId: sessionId, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(phoneRegistryRef, { uid, ownerUid: uid, clientId, accountPhoneNormalized, signupSessionId: sessionId, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(clientRef, { businessName: signup.businessName, ownerUid: uid, accountType: ACCOUNT_TYPES.OWNER, messagesEnabled, employeesEnabled, employeeMessagingEnabled, termsAccepted: true, privacyAccepted: true, termsVersion: signup.termsVersion, privacyVersion: signup.privacyVersion, legalAcceptedAt: acceptedAt, legalAcceptedBy: signup.accountEmail, ...activeFields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(accountSettingsRef, {
      BusinessName: signup.businessName,
      OwnerName: signup.ownerName,
      AccountEmail: signup.accountEmail,
      AccountPhone: signup.accountPhone,
      BillingEmail: signup.accountEmail,
      BillingStatus: "Active",
      AccountType: ACCOUNT_TYPES.OWNER,
      BillingPlan: "standard",
      BillingPlanName: "ARK AI Receptionist",
      BillingVersion: BILLING_VERSION,
      MonthlyBaseCents: MONTHLY_BASE_CENTS,
      IncludedLeads: 0,
      IncludedConversations: 0,
      IncludedEmployees: 0,
      PerLeadCents: PER_LEAD_CENTS,
      PerCallCents: PER_CALL_CENTS,
      PerChatCents: PER_CHAT_CENTS,
      PerMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
      MessagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
      PerEmployeeCents: PER_EMPLOYEE_CENTS,
      MessagesEnabled: messagesEnabled,
      EmployeesEnabled: employeesEnabled,
      EmployeeMessagingEnabled: employeeMessagingEnabled,
      PaymentMethodLabel: paymentMethodLabel,
      StripeCustomerId: customerId,
      StripeSubscriptionId: subscription.id,
      StripeSubscriptionStatus: subscription.status,
      IdentityVerificationStatus: "Pending",
      IdentityVerificationDeadlineAt: identityVerificationDeadlineAt,
      EmailVerificationStatus: "Pending",
      PhoneVerificationStatus: PHONE_VERIFICATION_REQUIRED ? "Pending" : "Not Required",
      NumberAssignmentStatus: "Needed",
      TermsAccepted: true,
      PrivacyAccepted: true,
      TermsVersion: signup.termsVersion,
      PrivacyVersion: signup.privacyVersion,
      LegalAcceptedAt: acceptedAt,
      LegalAcceptedBy: signup.accountEmail,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(receptionistSettingsRef, {
      clientId,
      businessSetupComplete: true,
      enabled: false,
      businessName: signup.businessName,
      ownerName: signup.ownerName,
      businessPhone: signup.accountPhone,
      businessEmail: signup.accountEmail,
      timeZone: signup.receptionist.timeZone,
      estimateDays: signup.receptionist.estimateDays,
      estimateWeekdays: signup.receptionist.estimateWeekdays,
      earliestEstimateStart: signup.receptionist.earliestEstimateStart,
      latestEstimateStart: signup.receptionist.latestEstimateStart,
      businessBase: signup.receptionist.businessBase,
      serviceAreas: signup.receptionist.serviceAreas,
      services: signup.receptionist.services,
      businessInformation: signup.receptionist.businessInformation || [],
      extraInformation: signup.receptionist.extraInformation,
      updatedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(receiptRef, {
      email: signup.accountEmail,
      clientId,
      uid,
      signupDigest: digest,
      handoffHash: handoff ? pendingOwnerSignupHandoffHash(handoff) : null,
      accountType: ACCOUNT_TYPES.OWNER,
      billingPlan: "standard",
      status: "active",
      stripeSubscriptionId: subscription.id,
      completed: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    await auth.setCustomUserClaims(uid, {
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      clientId,
      accountStatus: "active",
      billingPlan: "standard",
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      identityVerificationRequired: true,
      identityVerificationVerified: false,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
    });
    await stripe.customers.update(customerId, {
      email: signup.accountEmail,
      name: signup.ownerName,
      phone: signup.accountPhone,
      invoice_settings: { default_payment_method: paymentMethodId },
      metadata: { uid, clientId, businessName: signup.businessName, billingPlan: "standard", accountType: ACCOUNT_TYPES.OWNER, accountStatus: "active" },
    });

    let verificationDelivery = "sent";
    try {
      await sendAccountVerificationCodes({ db, uid, clientId, email: signup.accountEmail, phone: signup.accountPhone });
    } catch (error) {
      verificationDelivery = "needs_resend";
      console.error("Unable to deliver initial account verification codes", error);
    }
    const referral = await qualifyReferralAfterActivation({ db, stripe, referredClientId: clientId, referredUid: uid }).catch((error) => {
      console.error("Unable to qualify activated signup referral; billing sync will retry", error);
      return { status: "pending_activation" };
    });
    await deletePendingOwnerSignup({ db, sessionId });
    return NextResponse.json({
      email: signup.accountEmail,
      clientId,
      token: await auth.createCustomToken(uid),
      accountType: ACCOUNT_TYPES.OWNER,
      billingPlan: "standard",
      status: "active",
      completed: true,
      verificationRequired: true,
      verificationDelivery,
      numberAssignmentStatus: "needed",
      referralStatus: referral.status,
    });
  } catch (error) {
    console.error("Unable to finalize payment-gated owner signup", error);
    const safe = signupError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
