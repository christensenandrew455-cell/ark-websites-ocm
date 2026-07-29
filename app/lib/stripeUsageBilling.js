import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const BILLING_VERSION = "one-account-usage-v4";
export const MONTHLY_BASE_CENTS = 5000;
export const PER_CALL_CENTS = 200;
export const PER_MESSAGE_BUNDLE_CENTS = 100;
export const MESSAGE_PARTS_PER_BUNDLE = 50;
export const PER_EMPLOYEE_CENTS = 500;

export const INCLUDED_LEADS = 0;
export const INCLUDED_CONVERSATIONS = 0;
export const BUSINESS_INCLUDED_LEADS = 0;
export const BUSINESS_INCLUDED_CONVERSATIONS = 0;
export const BUSINESS_INCLUDED_EMPLOYEES = 0;
export const PER_OVERAGE_CENTS = PER_CALL_CENTS;
export const PER_EMPLOYEE_OVERAGE_CENTS = PER_EMPLOYEE_CENTS;
export const PER_LEAD_CENTS = PER_CALL_CENTS;
export const PER_MESSAGE_CONVERSATION_CENTS = PER_MESSAGE_BUNDLE_CENTS;

export const LEAD_METER_EVENT = "ark_account_call_v4";
export const MESSAGE_BUNDLE_METER_EVENT = "ark_account_message_bundle_v4";
export const CONVERSATION_METER_EVENT = MESSAGE_BUNDLE_METER_EVENT;
export const EMPLOYEE_METER_EVENT = "ark_account_employee_v4";
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

function text(value) { return String(value || "").trim(); }
export function normalizeBillingPlan() { return "standard"; }
export function billingPlanDefinition() { return BILLING_PLANS.standard; }
function activeSubscription(subscription) { return subscription && !["canceled", "incomplete_expired"].includes(subscription.status); }
async function retrieveUsableSubscription(stripe, subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
    return activeSubscription(subscription) ? subscription : null;
  } catch { return null; }
}
function configuredPrice(name) { return text(process.env[name]); }
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
    metadata: { ark_billing_component: component, ark_billing_version: BILLING_VERSION, unit_amount_cents: String(unitAmount) },
  });
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configRef = db.collection("systemConfig").doc("stripeOneAccountV4");
  const snapshot = await configRef.get();
  const saved = snapshot.exists ? snapshot.data() : {};
  let plansProductId = text(saved.plansProductId);
  let callProductId = text(saved.callProductId);
  let messageProductId = text(saved.messageProductId);
  let employeeProductId = text(saved.employeeProductId);
  let callMeterId = text(saved.callMeterId);
  let messageMeterId = text(saved.messageMeterId);
  let employeeMeterId = text(saved.employeeMeterId);
  let basePriceId = configuredPrice("STRIPE_ACCOUNT_BASE_PRICE_ID") || text(saved.basePriceId);
  let callPriceId = configuredPrice("STRIPE_ACCOUNT_CALL_PRICE_ID") || text(saved.callPriceId);
  let messagePriceId = configuredPrice("STRIPE_ACCOUNT_MESSAGE_PRICE_ID") || text(saved.messagePriceId);
  let employeePriceId = configuredPrice("STRIPE_ACCOUNT_EMPLOYEE_PRICE_ID") || text(saved.employeePriceId);

  if (!plansProductId) {
    plansProductId = (await stripe.products.create({
      name: "ARK AI Receptionist",
      description: "$50 monthly account with usage-based calls, SMS parts, and employees.",
      metadata: { ark_billing_component: "account", ark_billing_version: BILLING_VERSION },
    })).id;
  }
  if (!basePriceId) {
    basePriceId = (await stripe.prices.create({
      product: plansProductId,
      currency: "usd",
      unit_amount: MONTHLY_BASE_CENTS,
      recurring: { interval: "month" },
      nickname: "ARK AI Receptionist monthly account",
      metadata: { ark_billing_component: "base_account", ark_billing_plan: "standard", ark_billing_version: BILLING_VERSION },
    })).id;
  }
  if (!callMeterId) callMeterId = (await createMeter(stripe, "ARK AI Receptionist Calls", LEAD_METER_EVENT)).id;
  if (!messageMeterId) messageMeterId = (await createMeter(stripe, "ARK SMS 50-Part Bundles", MESSAGE_BUNDLE_METER_EVENT)).id;
  if (!employeeMeterId) employeeMeterId = (await createMeter(stripe, "ARK Active Employees", EMPLOYEE_METER_EVENT)).id;
  if (!callProductId) callProductId = (await stripe.products.create({ name: "ARK AI Receptionist Calls", description: "$2 for each new call or lead handled by the AI receptionist.", metadata: { ark_billing_component: "call_usage", ark_billing_version: BILLING_VERSION } })).id;
  if (!messageProductId) messageProductId = (await stripe.products.create({ name: "ARK SMS Usage", description: "$1 for each 50 inbound and outbound SMS message parts.", metadata: { ark_billing_component: "message_usage", ark_billing_version: BILLING_VERSION } })).id;
  if (!employeeProductId) employeeProductId = (await stripe.products.create({ name: "ARK Employee Accounts", description: "$5 for each active employee account during a billing period.", metadata: { ark_billing_component: "employee_usage", ark_billing_version: BILLING_VERSION } })).id;
  if (!callPriceId) callPriceId = (await createMeteredPrice({ stripe, productId: callProductId, meterId: callMeterId, nickname: "ARK calls at $2 each", component: "call_usage", unitAmount: PER_CALL_CENTS })).id;
  if (!messagePriceId) messagePriceId = (await createMeteredPrice({ stripe, productId: messageProductId, meterId: messageMeterId, nickname: "ARK SMS bundles at $1 per 50 parts", component: "message_usage", unitAmount: PER_MESSAGE_BUNDLE_CENTS })).id;
  if (!employeePriceId) employeePriceId = (await createMeteredPrice({ stripe, productId: employeeProductId, meterId: employeeMeterId, nickname: "ARK active employees at $5 each", component: "employee_usage", unitAmount: PER_EMPLOYEE_CENTS })).id;

  await configRef.set({
    billingVersion: BILLING_VERSION,
    plansProductId,
    basePriceId,
    callProductId,
    callMeterId,
    callEventName: LEAD_METER_EVENT,
    callPriceId,
    messageProductId,
    messageMeterId,
    messageEventName: MESSAGE_BUNDLE_METER_EVENT,
    messagePriceId,
    employeeProductId,
    employeeMeterId,
    employeeEventName: EMPLOYEE_METER_EVENT,
    employeePriceId,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    perCallCents: PER_CALL_CENTS,
    perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
    messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    perEmployeeCents: PER_EMPLOYEE_CENTS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { basePriceId, callPriceId, messagePriceId, employeePriceId };
}

function expectedPriceIds(catalog) { return [catalog.basePriceId, catalog.callPriceId, catalog.messagePriceId, catalog.employeePriceId]; }
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
    if (expected.has(priceId)) { items.push({ id: item.id }); expected.delete(priceId); }
    else items.push({ id: item.id, deleted: true });
  }
  for (const priceId of expected) items.push({ price: priceId });
  return stripe.subscriptions.update(subscription.id, { items, proration_behavior: "none", metadata });
}

export async function ensureCustomerBillingSubscription({ stripe, db, clientId, customerId, paymentMethodId, businessName, uid, existingSubscriptionId }) {
  const plan = BILLING_PLANS.standard;
  const catalog = await ensureStripeBillingCatalog({ stripe, db });
  const priceIds = expectedPriceIds(catalog);
  const metadata = { clientId, uid: text(uid), businessName: text(businessName), billingPlan: "standard", billingVersion: BILLING_VERSION };
  const existing = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));
  const subscription = existing
    ? await alignExistingSubscription({ stripe, subscription: existing, priceIds, metadata })
    : await stripe.subscriptions.create({ customer: customerId, default_payment_method: paymentMethodId || undefined, collection_method: "charge_automatically", items: priceIds.map((price) => ({ price })), payment_behavior: "error_if_incomplete", metadata });

  const update = {
    billingPlan: "standard",
    billingPlanName: plan.name,
    billingVersion: BILLING_VERSION,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    includedLeads: 0,
    includedConversations: 0,
    includedEmployees: 0,
    perCallCents: PER_CALL_CENTS,
    perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
    messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    perEmployeeCents: PER_EMPLOYEE_CENTS,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: catalog.basePriceId,
    stripeLeadPriceId: catalog.callPriceId,
    stripeMessagePriceId: catalog.messagePriceId,
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
      PerMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
      MessagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
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
async function reportMeterEvent({ stripe, eventName, identifier, customerId, occurredAt, value = 1 }) {
  return stripe.billing.meterEvents.create({
    event_name: eventName,
    identifier,
    timestamp: Math.floor(Number(occurredAt || Date.now()) / 1000),
    payload: { stripe_customer_id: customerId, value: String(value) },
  });
}
export async function reportBillableLead({ stripe, customerId, clientId, leadId, occurredAt }) {
  return reportMeterEvent({ stripe, eventName: LEAD_METER_EVENT, identifier: usageIdentifier("ark-v4-call", clientId, leadId), customerId, occurredAt });
}
export async function reportBillableMessageBundles({ stripe, customerId, clientId, billingPeriodKey, bundleCount, occurredAt }) {
  if (!bundleCount) return null;
  return reportMeterEvent({ stripe, eventName: MESSAGE_BUNDLE_METER_EVENT, identifier: usageIdentifier("ark-v4-message-bundles", clientId, billingPeriodKey), customerId, occurredAt, value: bundleCount });
}
export async function reportBillableConversation({ stripe, customerId, clientId, conversationId, occurredAt }) {
  return reportBillableMessageBundles({ stripe, customerId, clientId, billingPeriodKey: conversationId, bundleCount: 1, occurredAt });
}
export async function reportBillableEmployee({ stripe, customerId, clientId, employeeId, billingPeriodKey, occurredAt }) {
  return reportMeterEvent({ stripe, eventName: EMPLOYEE_METER_EVENT, identifier: usageIdentifier("ark-v4-employee", clientId, `${billingPeriodKey}:${employeeId}`), customerId, occurredAt });
}
