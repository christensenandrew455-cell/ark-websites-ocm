import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { loadBillingCalls } from "../../../lib/billingCallUsage";
import { loadBillingConversationUsage } from "../../../lib/billingConversationUsage";
import { loadBillingEmployeeUsage } from "../../../lib/billingEmployeeUsage";
import { loadBillingMessageUsage } from "../../../lib/billingMessageUsage";
import {
  BILLING_PLAN_NAME,
  BILLING_VERSION,
  calculateBillingSummary,
} from "../../../lib/billingPricing";
import { getAdminDb } from "../../../lib/firebase-admin";
import { TERMS_VERSION } from "../../../lib/legal";
import { referralCountForPeriod } from "../../../lib/referrals";
import {
  ensureCustomerBillingSubscription,
  refreshStoredPaymentMethod,
  resolveBillingWindow,
  syncStripeUsage,
} from "../../../lib/stripeUsageBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
async function loadActiveEmployees(db, clientId) {
  const snapshot = await db.collection("businesses").doc(clientId)
    .collection("employees").where("status", "==", "active").get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

function storedSummary(summary, window) {
  return {
    billingPlan: summary.billingPlan,
    billingPlanName: BILLING_PLAN_NAME,
    billingVersion: BILLING_VERSION,
    currentBillingMonth: window.monthKey,
    currentBillingPeriodStart: new Date(window.startMs),
    currentBillingPeriodEnd: new Date(window.endMs),
    currentMonthCallCount: summary.callCount,
    currentMonthLeadCount: summary.callCount,
    currentMonthChatCount: summary.chatCount,
    currentMonthChatUsageCents: summary.chatUsageCents,
    currentMonthMessageCount: summary.messageCount,
    currentMonthMessagePartCount: summary.messagePartCount,
    currentMonthMessageBundleCount: summary.messageBundleCount,
    currentMonthMessagePartUsageCents: summary.messagePartUsageCents,
    currentMonthEmployeeCount: summary.employeeCount,
    currentMonthCallUsageCents: summary.callUsageCents,
    currentMonthMessageUsageCents: summary.messageUsageCents,
    currentMonthEmployeeUsageCents: summary.employeeUsageCents,
    currentMonthUsageCents: summary.usageCents,
    currentMonthSubtotalCents: summary.subtotalCents,
    currentMonthReferralCount: summary.referralCount,
    currentMonthReferralDiscountPercent: summary.referralDiscountPercent,
    currentMonthReferralSavingsCents: summary.referralSavingsCents,
    currentMonthAmountDue: summary.amountDue,
    currentMonthCurrency: summary.currency,
    billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
  };
}

async function reconcileStripe({ db, auth, business, account, window, calls, conversationUsage, messageUsage, employeeUsage }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: "not-configured", callsSynced: 0, chatsSynced: 0, messagePartsSynced: 0, employeesSynced: 0 };
  }
  const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
  if (!customerId) {
    return { status: "payment-method-required", callsSynced: 0, chatsSynced: 0, messagePartsSynced: 0, employeesSynced: 0 };
  }
  if (account.termsAccepted !== true || text(account.termsVersion) !== TERMS_VERSION) {
    return { status: "terms-required", callsSynced: 0, chatsSynced: 0, messagePartsSynced: 0, employeesSynced: 0 };
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const subscriptionId = text(business.stripeSubscriptionId || account.stripeSubscriptionId);
  const refreshed = await refreshStoredPaymentMethod({
    stripe,
    db,
    clientId: auth.clientId,
    uid: auth.decodedToken.uid,
    customerId,
    subscriptionId,
    fallbackPaymentMethodId: text(business.stripePaymentMethodId || account.stripePaymentMethodId),
  });
  if (!refreshed.paymentMethodId) {
    return { status: "payment-method-required", callsSynced: 0, chatsSynced: 0, messagePartsSynced: 0, employeesSynced: 0 };
  }
  const subscription = await ensureCustomerBillingSubscription({
    stripe,
    db,
    clientId: auth.clientId,
    customerId,
    paymentMethodId: refreshed.paymentMethodId,
    businessName: text(business.businessName || account.businessName || auth.clientId),
    uid: auth.decodedToken.uid,
    existingSubscriptionId: subscriptionId,
  });
  const synced = await syncStripeUsage({
    db,
    stripe,
    clientId: auth.clientId,
    customerId,
    subscription,
    window,
    calls,
    conversations: conversationUsage.conversations,
    messageUsage,
    employeeIds: employeeUsage.employeeIds,
  });
  return { status: subscription.status, ...synced };
}

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;
  try {
    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(auth.clientId);
    const accountRef = db.collection("accounts").doc(auth.decodedToken.uid);
    const receptionistRef = db.collection("ocmClients").doc(auth.clientId)
      .collection("settings").doc("receptionist");
    const [businessSnapshot, accountSnapshot, receptionistSnapshot] = await Promise.all([
      businessRef.get(), accountRef.get(), receptionistRef.get(),
    ]);
    if (!businessSnapshot.exists) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    const business = businessSnapshot.data();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "")
      || text(business.timeZone || account.timeZone)
      || "America/New_York";
    const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
    const window = await resolveBillingWindow({
      stripe,
      subscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
      timeZone,
    });
    const [calls, activeEmployees, conversationUsage, messageUsage, referralCount] = await Promise.all([
      loadBillingCalls({ db, clientId: auth.clientId, startMs: window.startMs, endMs: window.endMs }),
      loadActiveEmployees(db, auth.clientId),
      loadBillingConversationUsage({ db, clientId: auth.clientId, startMs: window.startMs, endMs: window.endMs }),
      loadBillingMessageUsage({ db, clientId: auth.clientId, startMs: window.startMs, endMs: window.endMs }),
      referralCountForPeriod({ db, clientId: auth.clientId, billingPeriodKey: window.monthKey }),
    ]);
    const employeeUsage = await loadBillingEmployeeUsage({
      db,
      clientId: auth.clientId,
      window,
      activeEmployees,
    });
    const summary = calculateBillingSummary({
      callCount: calls.length,
      chatCount: conversationUsage.count,
      messagePartCount: messageUsage.parts,
      messageCount: messageUsage.messages,
      employeeCount: employeeUsage.count,
      referralCount,
    });

    let stripeSync = { status: "not-synced", callsSynced: 0, chatsSynced: 0, messagePartsSynced: 0, employeesSynced: 0 };
    try {
      stripeSync = await reconcileStripe({ db, auth, business, account, window, calls, conversationUsage, messageUsage, employeeUsage });
    } catch (stripeError) {
      console.error("Unable to reconcile monthly Stripe billing", stripeError);
      stripeSync = { status: "sync-error", callsSynced: 0, chatsSynced: 0, messagePartsSynced: 0, employeesSynced: 0 };
    }

    await Promise.all([
      businessRef.set(storedSummary(summary, window), { merge: true }),
      accountRef.set(storedSummary(summary, window), { merge: true }),
    ]);
    const messagesEnabled = business.messagesEnabled === true || account.messagesEnabled === true;
    const employeesEnabled = business.employeesEnabled === true || account.employeesEnabled === true;
    return NextResponse.json({
      ...summary,
      monthKey: window.monthKey,
      periodStart: new Date(window.startMs).toISOString(),
      periodEnd: new Date(window.endMs).toISOString(),
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled: messagesEnabled && employeesEnabled
        && (business.employeeMessagingEnabled === true || account.employeeMessagingEnabled === true),
      leadCount: summary.callCount,
      overageCents: summary.usageCents,
      perOverageCents: summary.perCallCents,
      perEmployeeOverageCents: summary.perEmployeeCents,
      employeeOverageCents: summary.employeeUsageCents,
      leadOverageCount: summary.callCount,
      conversationOverageCount: summary.chatCount,
      employeeOverageCount: summary.employeeCount,
      includedLeads: 0,
      includedConversations: 0,
      includedEmployees: 0,
      freeLeadsRemaining: 0,
      freeConversationsRemaining: 0,
      freeEmployeesRemaining: 0,
      stripeStatus: stripeSync.status,
      stripeCallsSynced: stripeSync.callsSynced,
      stripeLeadsSynced: stripeSync.callsSynced,
      stripeChatsSynced: stripeSync.chatsSynced,
      stripeMessagePartsSynced: stripeSync.messagePartsSynced,
      stripeEmployeesSynced: stripeSync.employeesSynced,
    });
  } catch (error) {
    console.error("Unable to load monthly billing summary", error);
    return NextResponse.json({ error: "Could not calculate this month's amount due." }, { status: 500 });
  }
}
