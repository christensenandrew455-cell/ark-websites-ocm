import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminDb } from "../../../lib/firebase-admin";
import { TERMS_VERSION } from "../../../lib/legal";
import { smsBundleCount } from "../../../lib/smsParts";
import {
  BILLING_VERSION,
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CALL_CENTS,
  PER_EMPLOYEE_CENTS,
  PER_MESSAGE_BUNDLE_CENTS,
  ensureCustomerBillingSubscription,
  reportBillableEmployee,
  reportBillableLead,
  reportBillableMessageBundles,
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
function usageKey(clientId, sourceId) {
  return createHash("sha256").update(`${clientId}:${sourceId}`).digest("hex").slice(0, 48);
}
function authorized(request) {
  const secret = text(process.env.CRON_SECRET);
  return Boolean(secret) && text(request.headers.get("authorization")) === `Bearer ${secret}`;
}
function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}
function zonedDateToUtc(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const first = zoneParts(new Date(guess), timeZone);
  const firstOffset = Date.UTC(first.year, first.month - 1, first.day, first.hour, first.minute, first.second) - guess;
  const adjusted = guess - firstOffset;
  const second = zoneParts(new Date(adjusted), timeZone);
  const secondOffset = Date.UTC(second.year, second.month - 1, second.day, second.hour, second.minute, second.second) - adjusted;
  return adjusted - secondOffset;
}
function calendarMonthWindow(timeZone) {
  const now = zoneParts(new Date(), timeZone);
  const nextYear = now.month === 12 ? now.year + 1 : now.year;
  const nextMonth = now.month === 12 ? 1 : now.month + 1;
  return {
    monthKey: `${now.year}-${String(now.month).padStart(2, "0")}`,
    startMs: zonedDateToUtc(now.year, now.month, 1, timeZone),
    endMs: zonedDateToUtc(nextYear, nextMonth, 1, timeZone),
  };
}
async function resolveBillingWindow(stripe, subscriptionId, timeZone) {
  const fallback = calendarMonthWindow(timeZone);
  if (!subscriptionId) return fallback;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data"] });
    const periods = (subscription.items?.data || [])
      .map((item) => ({
        startMs: Number(item.current_period_start || subscription.current_period_start || 0) * 1000,
        endMs: Number(item.current_period_end || subscription.current_period_end || 0) * 1000,
      }))
      .filter((period) => period.startMs > 0 && period.endMs > period.startMs);
    if (!periods.length) return fallback;
    const startMs = Math.max(...periods.map((period) => period.startMs));
    const endMs = Math.min(...periods.map((period) => period.endMs));
    return endMs > startMs
      ? { monthKey: new Date(startMs).toISOString().slice(0, 10), startMs, endMs }
      : fallback;
  } catch (error) {
    console.warn("Unable to read Stripe billing period; using calendar month", error);
    return fallback;
  }
}
async function monthlyCalls(db, clientId, startMs, endMs) {
  const snapshot = await db.collection("ocmClients").doc(clientId).collection("receptionistCalls").get();
  return snapshot.docs
    .map((document) => {
      const data = document.data();
      return { id: document.id, occurredAt: toMillis(data.startedAt || data.endedAt || data.createdAt) };
    })
    .filter((call) => call.occurredAt >= startMs && call.occurredAt < endMs)
    .sort((a, b) => a.occurredAt - b.occurredAt);
}
function isBillableMessage(data) {
  const direction = text(data.direction).toLowerCase();
  const status = text(data.deliveryStatus).toLowerCase();
  if (direction === "inbound") return status === "received";
  if (direction !== "outbound" || !text(data.providerMessageId)) return false;
  return !["provider-error", "provider-not-configured"].includes(status);
}
async function monthlyMessageUsage(db, clientId, startMs, endMs) {
  const conversations = await db.collection("ocmClients").doc(clientId).collection("leadConversations").get();
  let parts = 0;
  let messages = 0;
  for (const conversation of conversations.docs) {
    const snapshot = await conversation.ref.collection("messages").get();
    for (const document of snapshot.docs) {
      const data = document.data();
      const occurredAt = toMillis(data.createdAt || data.updatedAt);
      if (occurredAt < startMs || occurredAt >= endMs || !isBillableMessage(data)) continue;
      parts += Math.max(0, Number(data.smsParts || 0));
      messages += 1;
    }
  }
  return { parts, messages, bundles: smsBundleCount(parts, MESSAGE_PARTS_PER_BUNDLE) };
}
async function activeEmployees(db, clientId) {
  const snapshot = await db.collection("businesses").doc(clientId).collection("employees").where("status", "==", "active").get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}
async function syncUsage({ db, stripe, clientId, customerId, subscription, window, calls, messageUsage, employees, messagesEnabled, employeesEnabled }) {
  let callsSynced = 0;
  for (const call of calls) {
    const recordRef = db.collection("ocmClients").doc(clientId).collection("billingCallEvents").doc(usageKey(clientId, call.id));
    const record = await recordRef.get();
    if (record.exists && record.data().stripeReported === true) continue;
    await reportBillableLead({ stripe, customerId, clientId, leadId: call.id, occurredAt: call.occurredAt });
    await recordRef.set({ callId: call.id, occurredAt: new Date(call.occurredAt), stripeReported: true, stripePricingVersion: BILLING_VERSION, stripeCustomerId: customerId, stripeSubscriptionId: subscription.id, reportedAt: FieldValue.serverTimestamp() }, { merge: true });
    callsSynced += 1;
  }

  let messageBundlesSynced = 0;
  if (messagesEnabled && messageUsage.bundles > 0) {
    const recordRef = db.collection("ocmClients").doc(clientId).collection("billingMessageBundleEvents").doc(usageKey(clientId, window.monthKey));
    const record = await recordRef.get();
    const data = record.exists ? record.data() : {};
    const reportedBundles = data.stripeReported === true
      ? Math.max(0, Number(data.reportedBundleCount ?? data.bundleCount ?? 0))
      : 0;
    const additionalBundles = Math.max(0, messageUsage.bundles - reportedBundles);
    if (additionalBundles > 0) {
      await reportBillableMessageBundles({ stripe, customerId, clientId, billingPeriodKey: `${window.monthKey}:${messageUsage.bundles}`, bundleCount: additionalBundles, occurredAt: Date.now() });
      await recordRef.set({ billingPeriodKey: window.monthKey, smsParts: messageUsage.parts, bundleCount: messageUsage.bundles, reportedBundleCount: messageUsage.bundles, stripeReported: true, stripePricingVersion: BILLING_VERSION, stripeCustomerId: customerId, stripeSubscriptionId: subscription.id, reportedAt: FieldValue.serverTimestamp() }, { merge: true });
      messageBundlesSynced = additionalBundles;
    }
  }

  let employeesSynced = 0;
  if (employeesEnabled) {
    for (const employee of employees) {
      const eventKey = `${window.monthKey}:${employee.id}`;
      const recordRef = db.collection("ocmClients").doc(clientId).collection("billingEmployeeEvents").doc(usageKey(clientId, eventKey));
      const record = await recordRef.get();
      if (record.exists && record.data().stripeReported === true) continue;
      await reportBillableEmployee({ stripe, customerId, clientId, employeeId: employee.id, billingPeriodKey: window.monthKey, occurredAt: Date.now() });
      await recordRef.set({ employeeUid: employee.id, billingPeriodKey: window.monthKey, stripeReported: true, stripePricingVersion: BILLING_VERSION, stripeCustomerId: customerId, stripeSubscriptionId: subscription.id, reportedAt: FieldValue.serverTimestamp() }, { merge: true });
      employeesSynced += 1;
    }
  }
  return { callsSynced, messageBundlesSynced, employeesSynced };
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized. Configure CRON_SECRET and send it as a bearer token." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });

  const db = getAdminDb();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
      const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "") || "America/New_York";
      const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
      const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
      const acceptedCurrentTerms = account.termsAccepted === true && text(account.termsVersion) === TERMS_VERSION;
      const messagesEnabled = business.messagesEnabled === true || account.messagesEnabled === true;
      const employeesEnabled = business.employeesEnabled === true || account.employeesEnabled === true;
      const window = await resolveBillingWindow(stripe, text(business.stripeSubscriptionId || account.stripeSubscriptionId), timeZone);
      const [calls, messageUsage, employees] = await Promise.all([
        monthlyCalls(db, clientId, window.startMs, window.endMs),
        messagesEnabled ? monthlyMessageUsage(db, clientId, window.startMs, window.endMs) : Promise.resolve({ parts: 0, messages: 0, bundles: 0 }),
        employeesEnabled ? activeEmployees(db, clientId) : Promise.resolve([]),
      ]);
      const callUsageCents = calls.length * PER_CALL_CENTS;
      const messageUsageCents = messageUsage.bundles * PER_MESSAGE_BUNDLE_CENTS;
      const employeeUsageCents = employees.length * PER_EMPLOYEE_CENTS;
      const amountDue = MONTHLY_BASE_CENTS + callUsageCents + messageUsageCents + employeeUsageCents;
      let sync = { callsSynced: 0, messageBundlesSynced: 0, employeesSynced: 0 };

      if (customerId && paymentMethodId && acceptedCurrentTerms) {
        const subscription = await ensureCustomerBillingSubscription({
          stripe,
          db,
          clientId,
          customerId,
          paymentMethodId,
          businessName: text(business.businessName || account.businessName || clientId),
          uid,
          existingSubscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
        });
        sync = await syncUsage({ db, stripe, clientId, customerId, subscription, window, calls, messageUsage, employees, messagesEnabled, employeesEnabled });
      }

      const summary = {
        billingPlan: "standard",
        billingPlanName: "ARK AI Receptionist",
        billingVersion: BILLING_VERSION,
        currentBillingMonth: window.monthKey,
        currentMonthCallCount: calls.length,
        currentMonthLeadCount: calls.length,
        currentMonthMessageCount: messageUsage.messages,
        currentMonthMessagePartCount: messageUsage.parts,
        currentMonthMessageBundleCount: messageUsage.bundles,
        currentMonthEmployeeCount: employees.length,
        currentMonthCallUsageCents: callUsageCents,
        currentMonthMessageUsageCents: messageUsageCents,
        currentMonthEmployeeUsageCents: employeeUsageCents,
        currentMonthAmountDue: amountDue,
        currentMonthCurrency: "usd",
        billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
      };
      await Promise.all([
        document.ref.set(summary, { merge: true }),
        accountRef ? accountRef.set(summary, { merge: true }) : Promise.resolve(),
      ]);
      results.push({ clientId, calls: calls.length, messageBundles: messageUsage.bundles, employees: employees.length, amountDue, ...sync });
    } catch (error) {
      console.error(`Billing sync failed for ${clientId}`, error);
      results.push({ clientId, error: String(error?.message || "Billing sync failed.") });
    }
  }

  return NextResponse.json({ ok: true, accounts: results.length, results });
}
