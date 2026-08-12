import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ACCOUNT_TYPES, DEFAULT_EMPLOYEE_VISIBILITY, normalizePersonKey } from "../../../lib/accountTypes";
import { sendAccountVerificationCodes } from "../../../lib/accountVerification";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { qualifyReferralAfterActivation } from "../../../lib/referrals";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in before completing account setup." }, { status: 401 }) };
  try { return { decoded: await getAdminAuth().verifyIdToken(token, true) }; }
  catch { return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) }; }
}
function safeSignupError(error) {
  void error;
  return "Unable to finish account setup right now.";
}

export async function POST(request) {
  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const { sessionId } = await request.json();
    if (!sessionId) return NextResponse.json({ error: "The Stripe setup session is missing." }, { status: 400 });
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Unable to finish account setup right now." }, { status: 500 });

    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(authorization.decoded.uid);
    const receiptRef = db.collection("signupSessions").doc(sessionId);
    const [accountSnapshot, existingReceipt] = await Promise.all([accountRef.get(), receiptRef.get()]);
    if (!accountSnapshot.exists) return NextResponse.json({ error: "The owner account could not be found." }, { status: 404 });
    const account = accountSnapshot.data();
    if (existingReceipt.exists) {
      const receipt = existingReceipt.data();
      if (text(receipt.uid) !== authorization.decoded.uid) return NextResponse.json({ error: "That Stripe session belongs to a different account." }, { status: 403 });
      return NextResponse.json({ email: account.accountEmail, clientId: account.clientId, completed: true });
    }
    if (account.status === "active" && account.paymentSetupStatus === "complete") return NextResponse.json({ email: account.accountEmail, clientId: account.clientId, completed: true });
    if (account.status !== "approved_pending_payment") return NextResponse.json({ error: "This owner account is not waiting for payment setup." }, { status: 409 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    const metadata = session.metadata || {};
    if (text(metadata.uid) !== authorization.decoded.uid || text(metadata.clientId) !== text(account.clientId)) return NextResponse.json({ error: "That Stripe session does not match this owner account." }, { status: 403 });
    const setupIntent = session.setup_intent;
    const setupIntentStatus = typeof setupIntent === "string" ? "" : setupIntent?.status;
    if (session.mode !== "setup" || session.status !== "complete" || !setupIntent || setupIntentStatus !== "succeeded") return NextResponse.json({ error: "Stripe has not confirmed the payment method." }, { status: 402 });

    const clientId = text(account.clientId);
    const businessName = text(account.businessName || metadata.businessName || clientId);
    const ownerName = text(account.ownerName || metadata.ownerName);
    const accountEmail = text(account.accountEmail || metadata.accountEmail).toLowerCase();
    const accountPhone = text(account.accountPhone || metadata.accountPhone);
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || text(account.stripeCustomerId);
    const setupIntentId = typeof setupIntent === "string" ? setupIntent : setupIntent.id;
    const paymentMethodId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id || "";

    let paymentMethodLabel = "Card saved in Stripe";
    if (paymentMethodId) {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
      if (paymentMethod?.card) {
        const brand = text(paymentMethod.card.brand || "Card");
        paymentMethodLabel = `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${paymentMethod.card.last4}`;
      }
    }

    const messagesEnabled = account.messagesEnabled === true;
    const employeesEnabled = account.employeesEnabled === true;
    const employeeMessagingEnabled = messagesEnabled && employeesEnabled && account.employeeMessagingEnabled === true;
    const subscription = await ensureCustomerBillingSubscription({
      stripe,
      db,
      clientId,
      customerId,
      paymentMethodId,
      businessName,
      uid: authorization.decoded.uid,
      existingSubscriptionId: text(account.stripeSubscriptionId),
      subscriptionIdempotencyKey: `ark-owner-legacy-subscription-${sessionId}`,
      persist: false,
    });
    if (subscription.status !== "active") return NextResponse.json({ error: "The first account payment was not completed." }, { status: 402 });

    const activeAccount = {
      status: "active",
      verificationStatus: "pending",
      identityVerificationRequired: true,
      identityVerificationVerified: false,
      identityVerificationStatus: "pending",
      emailVerificationStatus: "pending",
      phoneVerificationStatus: "pending",
      paymentSetupStatus: "complete",
      businessSetupComplete: true,
      numberAssignmentStatus: "needed",
      onboardingTourStatus: "pending",
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      ownerUid: authorization.decoded.uid,
      ownerNameKey: account.ownerNameKey || normalizePersonKey(ownerName),
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
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      employeeVisibility: account.employeeVisibility || DEFAULT_EMPLOYEE_VISIBILITY,
      stripeCustomerId: customerId,
      stripeSetupIntentId: setupIntentId,
      stripePaymentMethodId: paymentMethodId,
      stripeCheckoutSessionId: sessionId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      paymentMethodLabel,
      submittedForNumberAt: FieldValue.serverTimestamp(),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const businessRef = db.collection("businesses").doc(clientId);
    const clientRef = db.collection("ocmClients").doc(clientId);
    const batch = db.batch();
    batch.set(accountRef, activeAccount, { merge: true });
    batch.set(businessRef, activeAccount, { merge: true });
    batch.set(db.collection("businessNameRegistry").doc(text(account.businessNameKey || clientId)), { clientId, businessName, ownerUid: authorization.decoded.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(clientRef, {
      businessName,
      ownerUid: authorization.decoded.uid,
      status: "active",
      businessSetupComplete: true,
      numberAssignmentStatus: "needed",
      onboardingTourStatus: "pending",
      identityVerificationRequired: true,
      identityVerificationVerified: false,
      accountType: ACCOUNT_TYPES.OWNER,
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
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      termsAccepted: account.termsAccepted === true,
      privacyAccepted: account.privacyAccepted === true,
      termsVersion: text(account.termsVersion),
      privacyVersion: text(account.privacyVersion),
      legalAcceptedAt: account.legalAcceptedAt || null,
      legalAcceptedBy: accountEmail,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(clientRef.collection("settings").doc("account"), {
      BusinessName: businessName,
      OwnerName: ownerName,
      AccountEmail: accountEmail,
      AccountPhone: accountPhone,
      BillingEmail: accountEmail,
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
      NumberAssignmentStatus: "Needed",
      TermsAccepted: account.termsAccepted === true,
      PrivacyAccepted: account.privacyAccepted === true,
      TermsVersion: text(account.termsVersion),
      PrivacyVersion: text(account.privacyVersion),
      LegalAcceptedAt: account.legalAcceptedAt || null,
      LegalAcceptedBy: accountEmail,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    batch.set(receiptRef, { email: accountEmail, clientId, uid: authorization.decoded.uid, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", status: "active", stripeSubscriptionId: subscription.id, completed: true, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();

    await getAdminAuth().setCustomUserClaims(authorization.decoded.uid, {
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
      termsAccepted: account.termsAccepted === true,
      privacyAccepted: account.privacyAccepted === true,
      termsVersion: text(account.termsVersion),
      privacyVersion: text(account.privacyVersion),
    });
    if (customerId) await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId }, metadata: { uid: authorization.decoded.uid, clientId, businessName, billingPlan: "standard", accountType: ACCOUNT_TYPES.OWNER, accountStatus: "active" } }).catch((stripeError) => console.error("Unable to update Stripe customer metadata", stripeError));
    let verificationDelivery = "sent";
    try { await sendAccountVerificationCodes({ db, uid: authorization.decoded.uid, clientId, email: accountEmail, phone: accountPhone }); }
    catch (deliveryError) { verificationDelivery = "needs_resend"; console.error("Unable to deliver initial verification codes", deliveryError); }
    await qualifyReferralAfterActivation({ db, stripe, referredClientId: clientId, referredUid: authorization.decoded.uid }).catch((referralError) => console.error("Unable to qualify legacy signup referral", referralError));
    return NextResponse.json({ email: accountEmail, clientId, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", status: "active", verificationRequired: true, verificationDelivery, numberAssignmentStatus: "needed", completed: true });
  } catch (error) {
    console.error("Unable to complete owner signup", error);
    return NextResponse.json({ error: safeSignupError(error) }, { status: 500 });
  }
}
