import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ACCOUNT_TYPES, DEFAULT_EMPLOYEE_VISIBILITY, normalizePersonKey } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { normalizeOwnerSignup, validateOwnerSignup } from "../../../lib/ownerSignup";
import { ownerSignupDigestMatches, ownerSignupUid } from "../../../lib/ownerSignupServer";
import { pendingReferralFields, qualifyReferralAfterActivation, validateReferrerAccount } from "../../../lib/referrals";
import { checkSignupAvailability, normalizeSignupPhone } from "../../../lib/signupAvailability";
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
  if (/private key|pem|credential|firebase admin/i.test(message)) return { status: 500, message: "Firebase Admin credentials are invalid. Check the Vercel Firebase variables, then redeploy." };
  if (/stripe|api key|authentication|payment|card|invoice|subscription/i.test(message)) return { status: 500, message: "Stripe could not activate the monthly account. Check the payment method and Stripe configuration." };
  return { status: 500, message: "Unable to finish account setup right now." };
}

function compatibleReservation(snapshot, sessionId, uid) {
  if (!snapshot.exists) return true;
  const data = snapshot.data();
  return text(data.signupSessionId) === sessionId || text(data.ownerUid || data.uid) === uid;
}

async function existingCompletion({ auth, db, receiptRef, digest }) {
  const receiptSnapshot = await receiptRef.get();
  if (!receiptSnapshot.exists) return null;
  const receipt = receiptSnapshot.data();
  if (text(receipt.signupDigest) !== digest) return { response: NextResponse.json({ error: "That payment session belongs to a different signup." }, { status: 403 }) };
  const uid = text(receipt.uid);
  const accountSnapshot = uid ? await db.collection("accounts").doc(uid).get() : null;
  if (!uid || !accountSnapshot?.exists || accountSnapshot.data().status !== "active") return null;
  return {
    response: NextResponse.json({
      email: text(accountSnapshot.data().accountEmail),
      clientId: text(accountSnapshot.data().clientId),
      token: await auth.createCustomToken(uid),
      completed: true,
    }),
  };
}

export async function POST(request) {
  let createdUser = false;
  let createdUid = "";
  try {
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe is not configured yet." }, { status: 500 });
    const { sessionId, signup: rawSignup } = await request.json();
    if (!sessionId || !rawSignup) return NextResponse.json({ error: "The payment session or signup information is missing." }, { status: 400 });

    const signup = normalizeOwnerSignup(rawSignup, { includePassword: true });
    const validationError = validateOwnerSignup(signup);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    const metadata = session.metadata || {};
    const clientId = normalizeClientId(signup.businessName);
    if (text(metadata.signupFlow) !== "payment-gated-v2" || text(metadata.clientId) !== clientId || !ownerSignupDigestMatches(signup, metadata.signupDigest)) {
      return NextResponse.json({ error: "That payment session does not match this signup." }, { status: 403 });
    }

    const setupIntent = session.setup_intent;
    const setupIntentStatus = typeof setupIntent === "string" ? "" : text(setupIntent?.status);
    if (session.mode !== "setup" || session.status !== "complete" || !setupIntent || setupIntentStatus !== "succeeded") {
      return NextResponse.json({ error: "Stripe has not confirmed the payment method." }, { status: 402 });
    }

    const customerId = typeof session.customer === "string" ? session.customer : text(session.customer?.id);
    const setupIntentId = typeof setupIntent === "string" ? setupIntent : text(setupIntent.id);
    const paymentMethodId = typeof setupIntent === "string"
      ? ""
      : typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : text(setupIntent.payment_method?.id);
    if (!customerId || !paymentMethodId) return NextResponse.json({ error: "Stripe did not return the saved payment method." }, { status: 402 });

    const db = getAdminDb();
    const auth = getAdminAuth();
    const uid = ownerSignupUid(sessionId);
    createdUid = uid;
    const accountPhoneNormalized = normalizeSignupPhone(signup.accountPhone);
    const digest = text(metadata.signupDigest);
    const accountRef = db.collection("accounts").doc(uid);
    const businessRef = db.collection("businesses").doc(clientId);
    const registryRef = db.collection("businessNameRegistry").doc(clientId);
    const receiptRef = db.collection("signupSessions").doc(sessionId);
    const completed = await existingCompletion({ auth, db, receiptRef, digest });
    if (completed) return completed.response;

    const [businessSnapshot, registrySnapshot, availability, userByUid] = await Promise.all([
      businessRef.get(),
      registryRef.get(),
      checkSignupAvailability({ auth, db, accountEmail: signup.accountEmail, accountPhone: signup.accountPhone, allowedUid: uid }),
      auth.getUser(uid).catch(() => null),
    ]);
    if (!compatibleReservation(businessSnapshot, sessionId, uid) || !compatibleReservation(registrySnapshot, sessionId, uid)) throw new Error("BUSINESS_TAKEN");
    if (availability.emailInUse) throw new Error("EMAIL_TAKEN");
    if (availability.phoneInUse) throw new Error("PHONE_TAKEN");
    if (userByUid && text(userByUid.email).toLowerCase() !== signup.accountEmail) throw new Error("EMAIL_TAKEN");

    const referrer = await validateReferrerAccount({ db, referrerAccountId: signup.referrerAccountId, referredClientId: clientId });
    if (!userByUid) {
      await auth.createUser({ uid, email: signup.accountEmail, password: signup.password, displayName: signup.ownerName, emailVerified: false, disabled: false });
      createdUser = true;
    }

    await db.runTransaction(async (transaction) => {
      const [business, registry] = await Promise.all([transaction.get(businessRef), transaction.get(registryRef)]);
      if (!compatibleReservation(business, sessionId, uid) || !compatibleReservation(registry, sessionId, uid)) throw new Error("BUSINESS_TAKEN");
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
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.set(accountRef, reservation, { merge: true });
      transaction.set(businessRef, reservation, { merge: true });
      transaction.set(registryRef, { clientId, businessName: signup.businessName, ownerUid: uid, signupSessionId: sessionId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    let paymentMethodLabel = "Card saved in Stripe";
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
    if (paymentMethod?.card) {
      const brand = text(paymentMethod.card.brand || "Card");
      paymentMethodLabel = `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${paymentMethod.card.last4}`;
    }

    const accountSnapshot = await accountRef.get();
    const subscription = await ensureCustomerBillingSubscription({
      stripe,
      db,
      clientId,
      customerId,
      paymentMethodId,
      businessName: signup.businessName,
      uid,
      existingSubscriptionId: text(accountSnapshot.exists ? accountSnapshot.data().stripeSubscriptionId : ""),
      persist: false,
    });
    const messagesEnabled = false;
    const employeesEnabled = false;
    const employeeMessagingEnabled = false;
    const acceptedAt = new Date();
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
      ...billingFields,
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      employeeVisibility: DEFAULT_EMPLOYEE_VISIBILITY,
      ...pendingReferralFields(referrer),
      status: "active",
      verificationStatus: "not_required",
      paymentSetupStatus: "complete",
      businessSetupComplete: true,
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
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      paymentMethodLabel,
      activatedAt: FieldValue.serverTimestamp(),
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
    batch.set(clientRef, {
      businessName: signup.businessName,
      ownerUid: uid,
      status: "active",
      businessSetupComplete: true,
      accountType: ACCOUNT_TYPES.OWNER,
      ...billingFields,
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
      legalAcceptedAt: acceptedAt,
      legalAcceptedBy: signup.accountEmail,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
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
      enabled: true,
      businessName: signup.businessName,
      ownerName: signup.ownerName,
      businessPhone: signup.accountPhone,
      businessEmail: signup.accountEmail,
      businessHours: signup.receptionist.businessHours,
      timeZone: signup.receptionist.timeZone,
      estimateDays: signup.receptionist.estimateDays,
      estimateWeekdays: signup.receptionist.estimateWeekdays,
      earliestEstimateStart: signup.receptionist.earliestEstimateStart,
      latestEstimateStart: signup.receptionist.latestEstimateStart,
      businessBase: signup.receptionist.businessBase,
      serviceAreas: signup.receptionist.serviceAreas,
      services: signup.receptionist.services,
      extraInformation: signup.receptionist.extraInformation,
      updatedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
    if (adminClientId && clientId !== adminClientId) {
      batch.set(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId), {
        Name: signup.ownerName,
        BusinessName: signup.businessName,
        Phone: signup.accountPhone,
        Email: signup.accountEmail,
        Address: signup.businessName,
        PropertyKey: `business-${clientId}`,
        Job: "ARK AI Receptionist account",
        BestContactMethod: signup.accountPhone ? "Call" : "Email",
        Notes: `ARK AI Receptionist customer account for ${signup.businessName}.`,
        source: "owner-signup",
        RelatedBusinessClientId: clientId,
        AccountStatus: "active",
        BillingPlan: "standard",
        BillingPlanName: "ARK AI Receptionist",
        TermsAccepted: true,
        PrivacyAccepted: true,
        TermsVersion: signup.termsVersion,
        PrivacyVersion: signup.privacyVersion,
        LegalAcceptedAt: acceptedAt,
        ContactNames: signup.ownerName ? [signup.ownerName] : [],
        Phones: signup.accountPhone ? [signup.accountPhone] : [],
        Emails: signup.accountEmail ? [signup.accountEmail] : [],
        currentStage: "clients",
        TotalJobs: 1,
        RepeatJobs: 0,
        createdAt: FieldValue.serverTimestamp(),
        movedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(receiptRef, { email: signup.accountEmail, clientId, uid, signupDigest: digest, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", completed: true, stripeSubscriptionId: subscription.id, createdAt: FieldValue.serverTimestamp() });
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
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
    });
    await stripe.customers.update(customerId, { email: signup.accountEmail, name: signup.ownerName, phone: signup.accountPhone, metadata: { uid, clientId, businessName: signup.businessName, billingPlan: "standard", accountType: ACCOUNT_TYPES.OWNER } }).catch((error) => console.error("Unable to update Stripe customer metadata", error));
    const referral = await qualifyReferralAfterActivation({ db, stripe, referredClientId: clientId, referredUid: uid }).catch((error) => {
      console.error("Unable to qualify signup referral; daily billing sync will retry", error);
      return { status: "pending_activation" };
    });

    return NextResponse.json({
      email: signup.accountEmail,
      clientId,
      token: await auth.createCustomToken(uid),
      accountType: ACCOUNT_TYPES.OWNER,
      billingPlan: "standard",
      completed: true,
      referralStatus: referral.status,
    });
  } catch (error) {
    console.error("Unable to finalize payment-gated owner signup", error);
    if (createdUser && createdUid && String(error?.message || "") === "BUSINESS_TAKEN") await getAdminAuth().deleteUser(createdUid).catch(() => null);
    const safe = signupError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
