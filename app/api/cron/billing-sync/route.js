import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { loadBillingEmployeeUsage } from "../../../lib/billingEmployeeUsage";
import { loadBillingMessageUsage } from "../../../lib/billingMessageUsage";
import { BILLING_PLAN_NAME, BILLING_VERSION, calculateBillingSummary } from "../../../lib/billingPricing";
import { getAdminDb } from "../../../lib/firebase-admin";
import { TERMS_VERSION } from "../../../lib/legal";
import {
  referralCountForPeriod,
  retryPendingReferralActivations,
  retryPendingReferralDiscounts,
} from "../../../lib/referrals";
import {
  ensureCustomerBillingSubscription,
  refreshStoredPaymentMethod,
  resolveBillingWindow,
  syncStripeUsage,
} from "../../../lib/stripeUsageBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) { return String(value || "").trim(); }
function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
function authorized(request) {
  const secret = text(process.env.CRON_SECRET);
  return Boolean(secret) && text(request.headers.get("authorization")) === `Bearer ${secret}`;
}
async function monthlyCalls(db, clientId, startMs, endMs) {
  const snapshot = await db.collection("ocmClients").doc(clientId).collection("receptionistCalls").get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return { id: document.id, occurredAt: toMillis(data.startedAt || data.endedAt || data.createdAt) };
  }).filter((call) => call.occurredAt >= startMs && call.occurredAt < endMs)
    .sort((a, b) => a.occurredAt - b.occurredAt);
}
async function activeEmployees(db, clientId) {
  const snapshot = await db.collection("businesses").doc(clientId).collection("employees")
    .where("status", "==", "active").get();
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
    currentMonthMessageCount: summary.messageCount,
    currentMonthMessagePartCount: summary.messagePartCount,
    currentMonthMessageBundleCount: summary.messageBundleCount,
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

async function handle(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized. Configure CRON_SECRET and send it as a bearer token." }, { status: 401 });
  }
  const db = getAdminDb();
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  const businesses = await db.collection("businesses").where("status", "==", "active").get();
  const results = [];

  for (const document of businesses.docs) {
    const clientId = document.id;
    const business = document.data();
    const uid = text(business.uid || business.ownerUid);
    try {
      const accountRef = uid ? db.collection("accounts").doc(uid) : null;
      const receptionistRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist");
      const [accountSnapshot, receptionistSnapshot] = await Promise.all([
        accountRef ? accountRef.get() : Promise.resolve(null),
        receptionistRef.get(),
      ]);
      const account = accountSnapshot?.exists ? accountSnapshot.data() : {};
      const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "")
        || text(business.timeZone || account.timeZone)
        || "America/New_York";
      const subscriptionId = text(business.stripeSubscriptionId || account.stripeSubscriptionId);
      const window = await resolveBillingWindow({ stripe, subscriptionId, timeZone });
      const [calls, currentActiveEmployees, messageUsage, referralCount] = await Promise.all([
        monthlyCalls(db, clientId, window.startMs, window.endMs),
        activeEmployees(db, clientId),
        loadBillingMessageUsage({ db, clientId, startMs: window.startMs, endMs: window.endMs }),
        referralCountForPeriod({ db, clientId, billingPeriodKey: window.monthKey }),
      ]);
      const employeeUsage = await loadBillingEmployeeUsage({
        db, clientId, window, activeEmployees: currentActiveEmployees,
      });
      const summary = calculateBillingSummary({
        callCount: calls.length,
        messageCount: messageUsage.messages,
        messagePartCount: messageUsage.parts,
        employeeCount: employeeUsage.count,
        referralCount,
      });

      // Save the app's calculation before any provider request. A Stripe outage must not freeze the UI.
      await Promise.all([
        document.ref.set(storedSummary(summary, window), { merge: true }),
        accountRef ? accountRef.set(storedSummary(summary, window), { merge: true }) : Promise.resolve(),
      ]);

      let sync = { status: stripe ? "not-synced" : "not-configured", callsSynced: 0, messageBundlesSynced: 0, employeesSynced: 0 };
      const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
      const acceptedCurrentTerms = account.termsAccepted === true && text(account.termsVersion) === TERMS_VERSION;
      if (stripe && customerId && acceptedCurrentTerms) {
        try {
          const refreshed = await refreshStoredPaymentMethod({
            stripe, db, clientId, uid, customerId, subscriptionId,
            fallbackPaymentMethodId: text(business.stripePaymentMethodId || account.stripePaymentMethodId),
          });
          if (refreshed.paymentMethodId) {
            const subscription = await ensureCustomerBillingSubscription({
              stripe,
              db,
              clientId,
              customerId,
              paymentMethodId: refreshed.paymentMethodId,
              businessName: text(business.businessName || account.businessName || clientId),
              uid,
              existingSubscriptionId: subscriptionId,
            });
            sync = {
              status: subscription.status,
              ...(await syncStripeUsage({
                db, stripe, clientId, customerId, subscription, window, calls, messageUsage,
                employeeIds: employeeUsage.employeeIds,
              })),
            };
          } else {
            sync.status = "payment-method-required";
          }
        } catch (stripeError) {
          console.error(`Stripe billing sync failed for ${clientId}`, stripeError);
          sync.status = "sync-error";
          sync.error = text(stripeError?.message);
        }
      }
      results.push({
        clientId,
        calls: summary.callCount,
        messageBundles: summary.messageBundleCount,
        employees: summary.employeeCount,
        referralDiscountPercent: summary.referralDiscountPercent,
        amountDue: summary.amountDue,
        ...sync,
      });
    } catch (error) {
      console.error(`Billing calculation failed for ${clientId}`, error);
      results.push({ clientId, error: text(error?.message) || "Billing calculation failed." });
    }
  }

  let referralRetries = [];
  let referralDiscountRetries = [];
  if (stripe) {
    try {
      referralRetries = await retryPendingReferralActivations({ db, stripe });
      referralDiscountRetries = await retryPendingReferralDiscounts({ db, stripe });
    } catch (error) {
      console.error("Referral retry failed", error);
    }
  }
  return NextResponse.json({
    ok: true,
    accounts: results.length,
    results,
    referralRetries,
    referralDiscountRetries,
  });
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
