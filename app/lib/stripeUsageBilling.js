import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const BILLING_VERSION = "one-account-usage-v3";
export const MONTHLY_BASE_CENTS = 5000;
export const PER_CALL_CENTS = 200;
export const PER_MESSAGE_CONVERSATION_CENTS = 100;
export const PER_EMPLOYEE_CENTS = 500;

// Compatibility exports used by older routes while the account model is migrated.
export const INCLUDED_LEADS = 0;
export const INCLUDED_CONVERSATIONS = 0;
export const BUSINESS_INCLUDED_LEADS = 0;
export const BUSINESS_INCLUDED_CONVERSATIONS = 0;
export const BUSINESS_INCLUDED_EMPLOYEES = 0;
export const PER_OVERAGE_CENTS = PER_CALL_CENTS;
export const PER_EMPLOYEE_OVERAGE_CENTS = PER_EMPLOYEE_CENTS;
export const PER_LEAD_CENTS = PER_CALL_CENTS;

export const LEAD_METER_EVENT = "ark_account_call_v3";
export const CONVERSATION_METER_EVENT = "ark_account_message_conversation_v3";
export const EMPLOYEE_METER_EVENT = "ark_account_employee_v3";
export const BILLABLE_LEAD_EVENT = LEAD_METER_EVENT;

export const BILLING_PLANS = Object.freeze({
  standard: Object.freeze({
    key: "standard",
    name: "ARK AI Receptionist",
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    includedLeads: 0,
    includedConversations: 0,
    includedEmployees: 0,
    conversationsEnabled: true,
    employeesEnabled: true,
  }),
});

function text(value) {
  return String(value || "").trim();
}

export function normalizeBillingPlan() {
  return "standard";
}

export function billingPlanDefinition() {
  return BILLING_PLANS.standard;
}

function activeSubscription(subscription) {
  return subscription && !["canceled", "incomplete_expired"].includes(subscription.status);
}

async function retrieveUsableSubscription(stripe, subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
    return activeSubscription(subscription) ? subscription : null;
  } catch {
    return null;
  }
}

function configuredPrice(name) {
  return text(process.env[name]);
}

async function createMeter(stripe, displayName, eventName) {
  return stripe.billing.meters.create({
    display_name: displayName,
    event_name: eventName,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
}

async function createMeteredPrice({ stripe, productId, meterId, nickname, component, unitAmount }) {
  return stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: { interval: "month", usage_type: "metered", meter: meterId },
    nickname,
    metadata: {
      ark_billing_component: component,
      ark_billing_version: BILLING_VERSION,
      unit_amount_cents: String(unitAmount),
    },
  });
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configRef = db.collection("systemConfig").doc("stripeOneAccountV3");
  const snapshot = await configRef.get();
  const saved = snapshot.exists ? snapshot.data() : {};

  let plansProductId = text(saved.plansProductId);
  let callProductId = text(saved.callProductId);
  let conversationProductId = text(saved.conversationProductId);
  let employeeProductId = text(saved.employeeProductId);
  let callMeterId = text(saved.callMeterId);
  let conversationMeterId = text(saved.conversationMeterId);
  let employeeMeterId = text(saved.employeeMeterId);

  let basePriceId = configuredPrice("STRIPE_ACCOUNT_BASE_PRICE_ID") || text(saved.basePriceId);
  let callPriceId = configuredPrice("STRIPE_ACCOUNT_CALL_PRICE_ID") || text(saved.callPriceId);
  let conversationPriceId = configuredPrice("STRIPE_ACCOUNT_MESSAGE_PRICE_ID") || text(saved.conversationPriceId);
  let employeePriceId = configuredPrice("STRIPE_ACCOUNT_EMPLOYEE_PRICE_ID") || text(saved.employeePriceId);

  if (!plansProductId) {
    const product = await stripe.products.create({
      name: "ARK AI Receptionist",
      description: "$50 monthly account with usage-based calls, message conversations, and employees.",
      metadata: { ark_billing_component: "account", ark_billing_version: BILLING_VERSION },
    });
    plansProductId = product.id;
  }

  if (!basePriceId) {
    const price = await stripe.prices.create({
      product: plansProductId,
      currency: "usd",
      unit_amount: MONTHLY_BASE_CENTS,
      recurring: { interval: "month" },
      nickname: "ARK AI Receptionist monthly account",
      metadata: {
        ark_billing_component: "base_account",
        ark_billing_plan: "standard",
        ark_billing_version: BILLING_VERSION,
      },
    });
    basePriceId = price.id;
  }

  if (!callMeterId) callMeterId = (await createMeter(stripe, "ARK AI Receptionist Calls", LEAD_METER_EVENT)).id;
  if (!conversationMeterId) conversationMeterId = (await createMeter(stripe, "ARK Message Conversations", CONVERSATION_METER_EVENT)).id;
  if (!employeeMeterId) employeeMeterId = (await createMeter(stripe, "ARK Active Employees", EMPLOYEE_METER_EVENT)).id;

  if (!callProductId) {
    callProductId = (await stripe.products.create({
      name: "ARK AI Receptionist Calls",
      description: "$2 for each new call or lead handled by the AI receptionist.",
      metadata: { ark_billing_component: "call_usage", ark_billing_version: BILLING_VERSION },
    })).id;
  }
  if (!conversationProductId) {
    conversationProductId = (await stripe.products.create({
      name: "ARK Message Conversations",
      description: "$1 when a new lead message conversation starts. Messages in the same thread are included.",
      metadata: { ark_billing_component: "message_usage", ark_billing_version: BILLING_VERSION },
    })).id;
  }
  if (!employeeProductId) {
    employeeProductId = (await stripe.products.create({
      name: "ARK Employee Accounts",
      description: "$5 for each active employee account during a billing period.",
      metadata: { ark_billing_component: "employee_usage", ark_billing_version: BILLING_VERSION },
    })).id;
  }

  if (!callPriceId) {
    callPriceId = (await createMeteredPrice({ stripe, productId: callProductId, meterId: callMeterId, nickname: "ARK calls at $2 each", component: "call_usage", unitAmount: PER_CALL_CENTS })).id;
  }
  if (!conversationPriceId) {
    conversationPriceId = (await createMeteredPrice({ stripe, productId: conversationProductId, meterId: conversationMeterId, nickname: "ARK message conversations at $1 each", component: "message_usage", unitAmount: PER_MESSAGE_CONVERSATION_CENTS })).id;
  }
  if (!employeePriceId) {
    employeePriceId = (await createMeteredPrice({ stripe, productId: employeeProductId, meterId: employeeMeterId, nickname: "ARK active employees at $5 each", component: "employee_usage", unitAmount: PER_EMPLOYEE_CENTS })).id;
  }

  await configRef.set({
    billingVersion: BILLING_VERSION,
    plansProductId,
    basePriceId,
    callProductId,
    callMeterId,
    callEventName: LEAD_METER_EVENT,
    callPriceId,
    conversationProductId,
    conversationMeterId,
    conversationEventName: CONVERSATION_METER_EVENT,
    conversationPriceId,
    employeeProductId,
    employeeMeterId,
    employeeEventName: EMPLOYEE_METER_EVENT,
    employeePriceId,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    perCallCents: PER_CALL_CENTS,
    perMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
    perEmployeeCents: PER_EMPLOYEE_CENTS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { basePriceId, callPriceId, conversationPriceId, employeePriceId };
}

function expectedPriceIds(catalog) {
  return [catalog.basePriceId, catalog.callPriceId, catalog.conversationPriceId, catalog.employeePriceId];
}

function subscriptionHasPrices(subscription, priceIds) {
  const existing = new Set((subscription?.items?.data || []).map((item) => text(item?.price?.id || item?.price)));
  return existing.size === priceIds.length && priceIds.every((priceId) => existing.has(priceId));
}

async function alignExistingSubscription({ stripe, subscription, priceIds, metadata }) {
  if (subscriptionHasPrices(subscription, priceIds) && text(subscription.metadata?.billingVersion) === BILLING_VERSION) return subscription;

  const existingItems = subscription.items?.data || [];
  const expected = new Set(priceIds);
  const items = [];
  for (const item of existingItems) {
    const priceId = text(item?.price?.id || item?.price);
    if (expected.has(priceId)) {
      items.push({ id: item.id });
      expected.delete(priceId);
    } else {
      items.push({ id: item.id, deleted: true });
    }
  }
  for (const priceId of expected) items.push({ price: priceId });

  return stripe.subscriptions.update(subscription.id, {
    items,
    proration_behavior: "none",
    metadata,
  });
}

export async function ensureCustomerBillingSubscription({
  stripe,
  db,
  clientId,
  customerId,
  paymentMethodId,
  businessName,
  uid,
  existingSubscriptionId,
}) {
  const plan = BILLING_PLANS.standard;
  const catalog = await ensureStripeBillingCatalog({ stripe, db });
  const priceIds = expectedPriceIds(catalog);
  const metadata = {
    clientId,
    uid: text(uid),
    businessName: text(businessName),
    billingPlan: "standard",
    billingVersion: BILLING_VERSION,
  };

  const existing = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));
  const subscription = existing
    ? await alignExistingSubscription({ stripe, subscription: existing, priceIds, metadata })
    : await stripe.subscriptions.create({
        customer: customerId,
        default_payment_method: paymentMethodId || undefined,
        collection_method: "charge_automatically",
        items: priceIds.map((price) => ({ price })),
        payment_behavior: "error_if_incomplete",
        metadata,
      });

  const update = {
    billingPlan: "standard",
    billingPlanName: plan.name,
    billingVersion: BILLING_VERSION,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    includedLeads: 0,
    includedConversations: 0,
    includedEmployees: 0,
    perCallCents: PER_CALL_CENTS,
    perMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
    perEmployeeCents: PER_EMPLOYEE_CENTS,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: catalog.basePriceId,
    stripeLeadPriceId: catalog.callPriceId,
    stripeConversationPriceId: catalog.conversationPriceId,
    stripeEmployeePriceId: catalog.employeePriceId,
    billingStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    db.collection("businesses").doc(clientId).set(update, { merge: true }),
    uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({
      BillingPlan: "standard",
      BillingPlanName: plan.name,
      BillingVersion: BILLING_VERSION,
      MonthlyBaseCents: MONTHLY_BASE_CENTS,
      IncludedLeads: 0,
      IncludedConversations: 0,
      IncludedEmployees: 0,
      PerCallCents: PER_CALL_CENTS,
      PerMessageConversationCents: PER_MESSAGE_CONVERSATION_CENTS,
      PerEmployeeCents: PER_EMPLOYEE_CENTS,
      StripeSubscriptionId: subscription.id,
      StripeSubscriptionStatus: subscription.status,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);

  return subscription;
}

function usageIdentifier(prefix, clientId, sourceId) {
  const hash = createHash("sha256").update(`${clientId}:${sourceId}`).digest("hex").slice(0, 48);
  return `${prefix}-${hash}`;
}

async function reportMeterEvent({ stripe, eventName, identifier, customerId, occurredAt }) {
  return stripe.billing.meterEvents.create({
    event_name: eventName,
    identifier,
    timestamp: Math.floor(Number(occurredAt || Date.now()) / 1000),
    payload: { stripe_customer_id: customerId, value: "1" },
  });
}

export async function reportBillableLead({ stripe, customerId, clientId, leadId, occurredAt }) {
  return reportMeterEvent({ stripe, eventName: LEAD_METER_EVENT, identifier: usageIdentifier("ark-v3-call", clientId, leadId), customerId, occurredAt });
}

export async function reportBillableConversation({ stripe, customerId, clientId, conversationId, occurredAt }) {
  return reportMeterEvent({ stripe, eventName: CONVERSATION_METER_EVENT, identifier: usageIdentifier("ark-v3-message", clientId, conversationId), customerId, occurredAt });
}

export async function reportBillableEmployee({ stripe, customerId, clientId, employeeId, billingPeriodKey, occurredAt }) {
  return reportMeterEvent({ stripe, eventName: EMPLOYEE_METER_EVENT, identifier: usageIdentifier("ark-v3-employee", clientId, `${billingPeriodKey}:${employeeId}`), customerId, occurredAt });
}
