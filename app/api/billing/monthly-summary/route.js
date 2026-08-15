import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { loadBillingConversationUsage } from "../../../lib/billingConversationUsage";
import { loadBillingLeads } from "../../../lib/billingLeadUsage";
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

function storedSummary(summary, window) {
  return {
    billingPlan: summary.billingPlan,
    billingPlanName: BILLING_PLAN_NAME,
    billingVersion: BILLING_VERSION,
    currentBillingMonth: window.monthKey,
    currentBillingPeriodStart: new Date(window.startMs),
    currentBillingPeriodEnd: new Date(window.endMs),
    currentMonthCallCount: summary.leadCount,
    currentMonthLeadCount: summary.leadCount,
    currentMonthChatCount: summary.chatCount,
    currentMonthChatUsageCents: summary.chatUsageCents,
    currentMonthMessageCount: summary.messageCount,
    currentMonthMessagePartCount: summary.messagePartCount,
    currentMonthMessageBundleCount: summary.messageBundleCount,
    currentMonthMessagePartBlockCount: summary.messagePartBlockCount,
    currentMessagePartRemainder: summary.messagePartRemainder,
    currentMonthMessagePartUsageCents: summary.messagePartUsageCents,
    currentMonthCallUsageCents: summary.leadUsageCents,
    currentMonthLeadUsageCents: summary.leadUsageCents,
    currentMonthMessageUsageCents: summary.messageUsageCents,
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

async function reconcileStripe({ db, auth, business, account, window, leads, conversationUsage, messageUsage }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: "not-configured", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
  }
  const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
  if (!customerId) {
    return { status: "payment-method-required", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
  }
  if (account.termsAccepted !== true || text(account.termsVersion) !== TERMS_VERSION) {
    return { status: "terms-required", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
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
    return { status: "payment-method-required", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
  }
  if (!subscriptionId) return { status: "subscription-pending", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
  const subscription = await ensureCustomerBillingSubscription({
    stripe,
    db,
    clientId: auth.clientId,
    customerId,
    paymentMethodId: refreshed.paymentMethodId,
    businessName: text(business.businessName || account.businessName || auth.clientId),
    uid: auth.decodedToken.uid,
    existingSubscriptionId: subscriptionId,
    createIfMissing: false,
  });
  if (!subscription) return { status: "subscription-pending", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
  const synced = await syncStripeUsage({
    db,
    stripe,
    clientId: auth.clientId,
    customerId,
    subscription,
    window,
    leads,
    conversations: conversationUsage.conversations,
    messageUsage,
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
    const [leads, conversationUsage, messageUsage, referralCount] = await Promise.all([
      loadBillingLeads({ db, clientId: auth.clientId, startMs: window.startMs, endMs: window.endMs }),
      loadBillingConversationUsage({ db, clientId: auth.clientId, startMs: window.startMs, endMs: window.endMs }),
      loadBillingMessageUsage({ db, clientId: auth.clientId, startMs: window.startMs, endMs: window.endMs }),
      referralCountForPeriod({ db, clientId: auth.clientId, billingPeriodKey: window.monthKey }),
    ]);
    const summary = calculateBillingSummary({
      leadCount: leads.length,
      chatCount: conversationUsage.count,
      messagePartCount: messageUsage.parts,
      messagePartBlockCount: messageUsage.blocks,
      messagePartRemainder: messageUsage.remainder,
      messageCount: messageUsage.messages,
      referralCount,
    });

    let stripeSync = { status: "not-synced", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
    try {
      stripeSync = await reconcileStripe({ db, auth, business, account, window, leads, conversationUsage, messageUsage });
    } catch (stripeError) {
      console.error("Unable to reconcile monthly Stripe billing", stripeError);
      stripeSync = { status: "sync-error", leadsSynced: 0, chatsSynced: 0, messagePartsSynced: 0 };
    }

    await Promise.all([
      businessRef.set(storedSummary(summary, window), { merge: true }),
      accountRef.set(storedSummary(summary, window), { merge: true }),
    ]);
    const messagesEnabled = business.messagesEnabled === true || account.messagesEnabled === true;
    return NextResponse.json({
      ...summary,
      monthKey: window.monthKey,
      periodStart: new Date(window.startMs).toISOString(),
      periodEnd: new Date(window.endMs).toISOString(),
      messagesEnabled,
      leadCount: summary.leadCount,
      overageCents: summary.usageCents,
      perOverageCents: summary.perLeadCents,
      leadOverageCount: summary.leadCount,
      conversationOverageCount: summary.chatCount,
      includedLeads: 0,
      includedConversations: 0,
      freeLeadsRemaining: 0,
      freeConversationsRemaining: 0,
      stripeStatus: stripeSync.status,
      stripeCallsSynced: 0,
      stripeLeadsSynced: stripeSync.leadsSynced,
      stripeChatsSynced: stripeSync.chatsSynced,
      stripeMessagePartsSynced: stripeSync.messagePartsSynced,
    });
  } catch (error) {
    console.error("Unable to load monthly billing summary", error);
    return NextResponse.json({ error: "Could not calculate this month's amount due." }, { status: 500 });
  }
}
