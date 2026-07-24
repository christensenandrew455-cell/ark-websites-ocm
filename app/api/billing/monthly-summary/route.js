import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import {
  BILLING_VERSION,
  billingPlanDefinition,
  ensureCustomerBillingSubscription,
  normalizeBillingPlan,
  PER_EMPLOYEE_OVERAGE_CENTS,
  PER_OVERAGE_CENTS,
  reportBillableConversation,
  reportBillableEmployee,
  reportBillableLead,
} from "../../../lib/stripeUsageBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
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

async function resolveBillingWindow({ business, account, timeZone }) {
  const fallback = calendarMonthWindow(timeZone);
  const subscriptionId = text(business.stripeSubscriptionId || account.stripeSubscriptionId);
  if (!process.env.STRIPE_SECRET_KEY || !subscriptionId) return fallback;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return fallback;

    return {
      monthKey: new Date(startMs).toISOString().slice(0, 10),
      startMs,
      endMs,
    };
  } catch (error) {
    console.warn("Unable to read the Stripe billing period; using the calendar month", error);
    return fallback;
  }
}

function leadTimestamp(data) {
  return toMillis(data.createdAt || data.contactedAt || data.acceptedAt || data.occurredAt || data.updatedAt);
}

function usageKey(clientId, sourceId) {
  return createHash("sha256").update(`${clientId}:${sourceId}`).digest("hex").slice(0, 48);
}

function addUsage(unique, id, occurredAt, startMs, endMs) {
  const cleanId = text(id);
  if (!cleanId || !occurredAt || occurredAt < startMs || occurredAt >= endMs) return;
  const existing = unique.get(cleanId);
  if (!existing || occurredAt < existing.occurredAt) unique.set(cleanId, { id: cleanId, occurredAt });
}

async function loadMonthlyLeads(db, clientId, startMs, endMs) {
  const root = db.collection("ocmClients").doc(clientId);
  const [contactedSnapshot, clientsSnapshot, statsSnapshot] = await Promise.all([
    root.collection("contactedMe").get(),
    root.collection("clients").get(),
    root.collection("statsEvents").get(),
  ]);

  const unique = new Map();
  for (const document of [...contactedSnapshot.docs, ...clientsSnapshot.docs]) {
    addUsage(unique, document.id, leadTimestamp(document.data()), startMs, endMs);
  }
  for (const document of statsSnapshot.docs) {
    const data = document.data();
    if (text(data.eventType).toLowerCase() !== "contacted") continue;
    const sourceId = text(data.sourceId) || document.id.replace(/^contacted:/, "");
    addUsage(unique, sourceId, leadTimestamp(data), startMs, endMs);
  }

  return [...unique.values()].sort((first, second) => first.occurredAt - second.occurredAt);
}

async function loadMonthlyConversations(db, clientId, startMs, endMs) {
  const snapshot = await db.collection("ocmClients").doc(clientId).collection("billingConversationEvents").get();
  const unique = new Map();
  for (const document of snapshot.docs) {
    const data = document.data();
    const conversationId = text(data.conversationId || data.leadId || document.id);
    const occurredAt = toMillis(data.startedAt || data.occurredAt || data.createdAt);
    addUsage(unique, conversationId, occurredAt, startMs, endMs);
  }
  return [...unique.values()].sort((first, second) => first.occurredAt - second.occurredAt);
}

async function loadActiveEmployees(db, clientId) {
  const snapshot = await db.collection("businesses").doc(clientId).collection("employees").where("status", "==", "active").get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function reconcileStripe({ db, auth, business, account, planKey, window, leads, conversations, employees }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: "not-configured", leadsSynced: 0, conversationsSynced: 0, employeesSynced: 0 };
  }

  const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
  const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
  if (!customerId || !paymentMethodId) {
    return { status: "payment-method-required", leadsSynced: 0, conversationsSynced: 0, employeesSynced: 0 };
  }
  if (account.termsAccepted !== true) {
    return { status: "terms-required", leadsSynced: 0, conversationsSynced: 0, employeesSynced: 0 };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const subscription = await ensureCustomerBillingSubscription({
    stripe,
    db,
    clientId: auth.clientId,
    customerId,
    paymentMethodId,
    businessName: text(business.businessName || account.businessName || auth.clientId),
    uid: auth.decodedToken.uid,
    billingPlan: planKey,
    existingSubscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
  });

  let leadsSynced = 0;
  for (const lead of leads) {
    const recordRef = db.collection("ocmClients").doc(auth.clientId).collection("billingLeadEvents").doc(usageKey(auth.clientId, lead.id));
    const record = await recordRef.get();
    const recordData = record.exists ? record.data() : {};
    if (recordData.stripeReported === true && text(recordData.stripePricingVersion) === BILLING_VERSION) continue;

    await reportBillableLead({ stripe, customerId, clientId: auth.clientId, leadId: lead.id, occurredAt: lead.occurredAt });
    await recordRef.set({
      leadId: lead.id,
      occurredAt: new Date(lead.occurredAt),
      stripeReported: true,
      stripePricingVersion: BILLING_VERSION,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      reportedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    leadsSynced += 1;
  }

  let conversationsSynced = 0;
  if (billingPlanDefinition(planKey).conversationsEnabled) {
    for (const conversation of conversations) {
      const recordRef = db.collection("ocmClients").doc(auth.clientId).collection("billingConversationEvents").doc(usageKey(auth.clientId, conversation.id));
      const record = await recordRef.get();
      const recordData = record.exists ? record.data() : {};
      if (recordData.stripeReported === true && text(recordData.stripePricingVersion) === BILLING_VERSION) continue;

      await reportBillableConversation({
        stripe,
        customerId,
        clientId: auth.clientId,
        conversationId: conversation.id,
        occurredAt: conversation.occurredAt,
      });
      await recordRef.set({
        conversationId: conversation.id,
        startedAt: new Date(conversation.occurredAt),
        stripeReported: true,
        stripePricingVersion: BILLING_VERSION,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        reportedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      conversationsSynced += 1;
    }
  }

  let employeesSynced = 0;
  if (planKey === "business") {
    for (const employee of employees) {
      const eventKey = `${window.monthKey}:${employee.id}`;
      const recordRef = db.collection("ocmClients").doc(auth.clientId).collection("billingEmployeeEvents").doc(usageKey(auth.clientId, eventKey));
      const record = await recordRef.get();
      const recordData = record.exists ? record.data() : {};
      if (recordData.stripeReported === true && text(recordData.stripePricingVersion) === BILLING_VERSION) continue;

      await reportBillableEmployee({
        stripe,
        customerId,
        clientId: auth.clientId,
        employeeId: employee.id,
        billingPeriodKey: window.monthKey,
        occurredAt: Date.now(),
      });
      await recordRef.set({
        employeeUid: employee.id,
        billingPeriodKey: window.monthKey,
        stripeReported: true,
        stripePricingVersion: BILLING_VERSION,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        reportedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      employeesSynced += 1;
    }
  }

  return { status: subscription.status, leadsSynced, conversationsSynced, employeesSynced };
}

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(auth.clientId);
    const accountRef = db.collection("accounts").doc(auth.decodedToken.uid);
    const receptionistRef = db.collection("ocmClients").doc(auth.clientId).collection("settings").doc("receptionist");
    const [businessSnapshot, accountSnapshot, receptionistSnapshot] = await Promise.all([
      businessRef.get(),
      accountRef.get(),
      receptionistRef.get(),
    ]);

    if (!businessSnapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    const business = businessSnapshot.data();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const planKey = normalizeBillingPlan(account.billingPlan || business.billingPlan);
    const plan = billingPlanDefinition(planKey);
    const timeZone = text(receptionistSnapshot.exists ? receptionistSnapshot.data().timeZone : "") || "America/New_York";
    const window = await resolveBillingWindow({ business, account, timeZone });

    const [leads, conversations, employees] = await Promise.all([
      loadMonthlyLeads(db, auth.clientId, window.startMs, window.endMs),
      plan.conversationsEnabled
        ? loadMonthlyConversations(db, auth.clientId, window.startMs, window.endMs)
        : Promise.resolve([]),
      plan.employeesEnabled ? loadActiveEmployees(db, auth.clientId) : Promise.resolve([]),
    ]);

    const leadOverageCount = Math.max(0, leads.length - plan.includedLeads);
    const conversationOverageCount = plan.conversationsEnabled
      ? Math.max(0, conversations.length - plan.includedConversations)
      : 0;
    const employeeOverageCount = plan.employeesEnabled
      ? Math.max(0, employees.length - plan.includedEmployees)
      : 0;
    const leadOverageCents = leadOverageCount * PER_OVERAGE_CENTS;
    const conversationOverageCents = conversationOverageCount * PER_OVERAGE_CENTS;
    const employeeOverageCents = employeeOverageCount * PER_EMPLOYEE_OVERAGE_CENTS;
    const overageCents = leadOverageCents + conversationOverageCents + employeeOverageCents;
    const amountDue = plan.monthlyBaseCents + overageCents;

    let stripe = { status: "not-synced", leadsSynced: 0, conversationsSynced: 0, employeesSynced: 0 };
    try {
      stripe = await reconcileStripe({ db, auth, business, account, planKey, window, leads, conversations, employees });
    } catch (stripeError) {
      console.error("Unable to reconcile monthly Stripe billing", stripeError);
      stripe = { status: "sync-error", leadsSynced: 0, conversationsSynced: 0, employeesSynced: 0 };
    }

    const summaryUpdate = {
      billingPlan: planKey,
      billingPlanName: plan.name,
      billingVersion: BILLING_VERSION,
      currentBillingMonth: window.monthKey,
      currentMonthLeadCount: leads.length,
      currentMonthConversationCount: conversations.length,
      currentMonthEmployeeCount: employees.length,
      currentMonthLeadOverageCount: leadOverageCount,
      currentMonthConversationOverageCount: conversationOverageCount,
      currentMonthEmployeeOverageCount: employeeOverageCount,
      currentMonthOverageCents: overageCents,
      currentMonthAmountDue: amountDue,
      currentMonthCurrency: "usd",
      billingSummaryUpdatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all([
      businessRef.set(summaryUpdate, { merge: true }),
      accountRef.set(summaryUpdate, { merge: true }),
    ]);

    return NextResponse.json({
      monthKey: window.monthKey,
      periodStart: new Date(window.startMs).toISOString(),
      periodEnd: new Date(window.endMs).toISOString(),
      billingPlan: planKey,
      planName: plan.name,
      amountDue,
      currency: "usd",
      monthlyBaseCents: plan.monthlyBaseCents,
      overageCents,
      perOverageCents: PER_OVERAGE_CENTS,
      perEmployeeOverageCents: PER_EMPLOYEE_OVERAGE_CENTS,
      leadCount: leads.length,
      includedLeads: plan.includedLeads,
      freeLeadsRemaining: Math.max(0, plan.includedLeads - leads.length),
      leadOverageCount,
      leadOverageCents,
      conversationsEnabled: plan.conversationsEnabled,
      conversationCount: conversations.length,
      includedConversations: plan.includedConversations,
      freeConversationsRemaining: Math.max(0, plan.includedConversations - conversations.length),
      conversationOverageCount,
      conversationOverageCents,
      employeesEnabled: plan.employeesEnabled,
      employeeCount: employees.length,
      includedEmployees: plan.includedEmployees,
      freeEmployeesRemaining: Math.max(0, plan.includedEmployees - employees.length),
      employeeOverageCount,
      employeeOverageCents,
      stripeStatus: stripe.status,
      stripeLeadsSynced: stripe.leadsSynced,
      stripeConversationsSynced: stripe.conversationsSynced,
      stripeEmployeesSynced: stripe.employeesSynced,
    });
  } catch (error) {
    console.error("Unable to load monthly billing summary", error);
    return NextResponse.json({ error: "Could not calculate this month's amount due." }, { status: 500 });
  }
}
