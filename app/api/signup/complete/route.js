import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ACCOUNT_TYPES, DEFAULT_EMPLOYEE_VISIBILITY, normalizePersonKey } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import {
  BILLING_VERSION,
  MONTHLY_BASE_CENTS,
  PER_CALL_CENTS,
  PER_EMPLOYEE_CENTS,
  PER_MESSAGE_CONVERSATION_CENTS,
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
  const message = String(error?.message || "");
  if (/private key|pem|credential|firebase admin/i.test(message)) return "Firebase Admin credentials are invalid. Check the Vercel Firebase variables, then redeploy.";
  if (/stripe|api key|authentication|payment|card|invoice|subscription/i.test(message)) return "Stripe could not activate the monthly account. Check the payment method and Stripe configuration.";
  return "Unable to finish account setup right now.";
}

export async function POST(request) {
  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const { sessionId } = await request.json();
    if (!sessionId) return NextResponse.json({ error: "The Stripe setup session is missing." }, { status: 400 });
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe is not configured yet." }, { status: 500 });

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

    const subscription = await ensureCustomerBillingSubscription({ stripe, db, clientId, customerId, paymentMethodId, businessName, uid: authorization.decoded.uid, existingSubscriptionId: text(account.stripeSubscriptionId) });
    const messagesEnabled = account.messagesEnabled === true;
    const employeesEnabled = account.employeesEnabled === true;
    const employeeMessagingEnabled = messagesEnabled && employeesEnabled && account.employeeMessagingEnabled === true;
    const activeAccount = {
      status: "active",
      verificationStatus: "not_required",
      paymentSetupStatus: "complete",
      businessSetupComplete: false,
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
      perCallCents: PER_CALL_CENTS,
      perMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
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
      businessSetupComplete: false,
      accountType: ACCOUNT_TYPES.OWNER,
      billingPlan: "standard",
      billingPlanName: "ARK AI Receptionist",
      billingVersion: BILLING_VERSION,
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      includedLeads: 0,
      includedConversations: 0,
      includedEmployees: 0,
      perCallCents: PER_CALL_CENTS,
      perMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
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
      PerCallCents: PER_CALL_CENTS,
      PerMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
      PerEmployeeCents: PER_EMPLOYEE_CENTS,
      MessagesEnabled: messagesEnabled,
      EmployeesEnabled: employeesEnabled,
      EmployeeMessagingEnabled: employeeMessagingEnabled,
      PaymentMethodLabel: paymentMethodLabel,
      StripeCustomerId: customerId,
      StripeSubscriptionId: subscription.id,
      StripeSubscriptionStatus: subscription.status,
      TermsAccepted: account.termsAccepted === true,
      PrivacyAccepted: account.privacyAccepted === true,
      TermsVersion: text(account.termsVersion),
      PrivacyVersion: text(account.privacyVersion),
      LegalAcceptedAt: account.legalAcceptedAt || null,
      LegalAcceptedBy: accountEmail,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
    if (adminClientId && clientId !== adminClientId) {
      batch.set(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId), {
        Name: ownerName,
        BusinessName: businessName,
        Phone: accountPhone,
        Email: accountEmail,
        Address: businessName,
        PropertyKey: `business-${clientId}`,
        Job: "ARK AI Receptionist account",
        BestContactMethod: accountPhone ? "Call" : "Email",
        Notes: `ARK AI Receptionist customer account for ${businessName}.`,
        source: "owner-signup",
        RelatedBusinessClientId: clientId,
        AccountStatus: "active",
        BillingPlan: "standard",
        BillingPlanName: "ARK AI Receptionist",
        TermsAccepted: account.termsAccepted === true,
        PrivacyAccepted: account.privacyAccepted === true,
        TermsVersion: text(account.termsVersion),
        PrivacyVersion: text(account.privacyVersion),
        LegalAcceptedAt: account.legalAcceptedAt || null,
        ContactNames: ownerName ? [ownerName] : [],
        Phones: accountPhone ? [accountPhone] : [],
        Emails: accountEmail ? [accountEmail] : [],
        currentStage: "clients",
        TotalJobs: 1,
        RepeatJobs: 0,
        createdAt: FieldValue.serverTimestamp(),
        movedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    batch.set(receiptRef, { email: accountEmail, clientId, uid: authorization.decoded.uid, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", completed: true, stripeSubscriptionId: subscription.id, createdAt: FieldValue.serverTimestamp() });
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
      termsAccepted: account.termsAccepted === true,
      privacyAccepted: account.privacyAccepted === true,
      termsVersion: text(account.termsVersion),
      privacyVersion: text(account.privacyVersion),
    });
    if (customerId) await stripe.customers.update(customerId, { metadata: { uid: authorization.decoded.uid, clientId, businessName, billingPlan: "standard", accountType: ACCOUNT_TYPES.OWNER } }).catch((stripeError) => console.error("Unable to update Stripe customer metadata", stripeError));
    return NextResponse.json({ email: accountEmail, clientId, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", completed: true });
  } catch (error) {
    console.error("Unable to complete owner signup", error);
    return NextResponse.json({ error: safeSignupError(error) }, { status: 500 });
  }
}
