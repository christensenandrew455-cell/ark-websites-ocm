import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const BILLING_VERSION = "solo-business-plans-v2";
export const INCLUDED_LEADS = 50;
export const INCLUDED_CONVERSATIONS = 50;
export const BUSINESS_INCLUDED_LEADS = 75;
export const BUSINESS_INCLUDED_CONVERSATIONS = 75;
export const BUSINESS_INCLUDED_EMPLOYEES = 3;
export const PER_OVERAGE_CENTS = 500;
export const PER_EMPLOYEE_OVERAGE_CENTS = 2500;
export const LEAD_METER_EVENT = "ark_plan_lead_v2";
export const CONVERSATION_METER_EVENT = "ark_plan_conversation_v2";
export const EMPLOYEE_METER_EVENT = "ark_business_employee_v2";

export const BILLING_PLANS = Object.freeze({
  solo: Object.freeze({
    key: "solo",
    name: "Solo",
    monthlyBaseCents: 10000,
    includedLeads: INCLUDED_LEADS,
    includedConversations: 0,
    includedEmployees: 0,
    conversationsEnabled: false,
    employeesEnabled: false,
  }),
  solo_pro: Object.freeze({
    key: "solo_pro",
    name: "Solo Pro",
    monthlyBaseCents: 20000,
    includedLeads: INCLUDED_LEADS,
    includedConversations: INCLUDED_CONVERSATIONS,
    includedEmployees: 0,
    conversationsEnabled: true,
    employeesEnabled: false,
  }),
  business: Object.freeze({
    key: "business",
    name: "Business",
    monthlyBaseCents: 30000,
    includedLeads: BUSINESS_INCLUDED_LEADS,
    includedConversations: BUSINESS_INCLUDED_CONVERSATIONS,
    includedEmployees: BUSINESS_INCLUDED_EMPLOYEES,
    conversationsEnabled: true,
    employeesEnabled: true,
  }),
});

// Backward-compatible exports for older imports.
export const MONTHLY_BASE_CENTS = BILLING_PLANS.solo.monthlyBaseCents;
export const PER_LEAD_CENTS = PER_OVERAGE_CENTS;
export const BILLABLE_LEAD_EVENT = LEAD_METER_EVENT;

function text(value) {
  return String(value || "").trim();
}

export function normalizeBillingPlan(value) {
  const candidate = text(value).toLowerCase();
  if (candidate === "business") return "business";
  if (candidate === "solo_pro") return "solo_pro";
  return "solo";
}

export function billingPlanDefinition(value) {
  return BILLING_PLANS[normalizeBillingPlan(value)];
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

async function createTieredMeteredPrice({
  stripe,
  productId,
  meterId,
  nickname,
  component,
  includedUnits,
  overageCents,
}) {
  return stripe.prices.create({
    product: productId,
    currency: "usd",
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers: [
      { up_to: includedUnits, unit_amount: 0 },
      { up_to: "inf", unit_amount: overageCents },
    ],
    recurring: { interval: "month", usage_type: "metered", meter: meterId },
    nickname,
    metadata: {
      ark_billing_component: component,
      ark_billing_version: BILLING_VERSION,
      included_units: String(includedUnits),
      overage_cents: String(overageCents),
    },
  });
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configRef = db.collection("systemConfig").doc("stripePlansV2");
  const snapshot = await configRef.get();
  const saved = snapshot.exists ? snapshot.data() : {};

  let plansProductId = text(saved.plansProductId);
  let leadProductId = text(saved.leadProductId);
  let conversationProductId = text(saved.conversationProductId);
  let employeeProductId = text(saved.employeeProductId);
  let leadMeterId = text(saved.leadMeterId);
  let conversationMeterId = text(saved.conversationMeterId);
  let employeeMeterId = text(saved.employeeMeterId);

  let soloBasePriceId = configuredPrice("STRIPE_SOLO_BASE_PRICE_ID") || text(saved.soloBasePriceId);
  let soloProBasePriceId = configuredPrice("STRIPE_SOLO_PRO_BASE_PRICE_ID") || text(saved.soloProBasePriceId);
  let businessBasePriceId = configuredPrice("STRIPE_BUSINESS_BASE_PRICE_ID") || text(saved.businessBasePriceId);
  let soloLeadOveragePriceId = configuredPrice("STRIPE_SOLO_LEAD_PRICE_ID") || text(saved.soloLeadOveragePriceId);
  let businessLeadOveragePriceId = configuredPrice("STRIPE_BUSINESS_LEAD_PRICE_ID") || text(saved.businessLeadOveragePriceId);
  let soloConversationOveragePriceId = configuredPrice("STRIPE_SOLO_CONVERSATION_PRICE_ID") || text(saved.soloConversationOveragePriceId);
  let businessConversationOveragePriceId = configuredPrice("STRIPE_BUSINESS_CONVERSATION_PRICE_ID") || text(saved.businessConversationOveragePriceId);
  let employeeOveragePriceId = configuredPrice("STRIPE_BUSINESS_EMPLOYEE_PRICE_ID") || text(saved.employeeOveragePriceId);

  if (!plansProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Plans",
      description: "ARK OCM Solo, Solo Pro, and Business monthly plans.",
      metadata: { ark_billing_component: "plans", ark_billing_version: BILLING_VERSION },
    });
    plansProductId = product.id;
  }

  async function ensureBasePrice(currentId, planKey, nickname) {
    if (currentId) return currentId;
    const plan = BILLING_PLANS[planKey];
    const price = await stripe.prices.create({
      product: plansProductId,
      currency: "usd",
      unit_amount: plan.monthlyBaseCents,
      recurring: { interval: "month" },
      nickname,
      metadata: {
        ark_billing_component: "base_plan",
        ark_billing_plan: planKey,
        ark_billing_version: BILLING_VERSION,
      },
    });
    return price.id;
  }

  soloBasePriceId = await ensureBasePrice(soloBasePriceId, "solo", "ARK OCM Solo monthly plan");
  soloProBasePriceId = await ensureBasePrice(soloProBasePriceId, "solo_pro", "ARK OCM Solo Pro monthly plan");
  businessBasePriceId = await ensureBasePrice(businessBasePriceId, "business", "ARK OCM Business monthly plan");

  if (!leadMeterId) {
    const meter = await createMeter(stripe, "ARK OCM Plan Leads", LEAD_METER_EVENT);
    leadMeterId = meter.id;
  }
  if (!leadProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Lead Overage",
      description: "Plan-specific included leads followed by a $5 per-lead overage.",
      metadata: { ark_billing_component: "lead_overage", ark_billing_version: BILLING_VERSION },
    });
    leadProductId = product.id;
  }
  if (!soloLeadOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: leadProductId,
      meterId: leadMeterId,
      nickname: "ARK OCM Solo leads: 50 included, then $5 each",
      component: "solo_lead_overage",
      includedUnits: INCLUDED_LEADS,
      overageCents: PER_OVERAGE_CENTS,
    });
    soloLeadOveragePriceId = price.id;
  }
  if (!businessLeadOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: leadProductId,
      meterId: leadMeterId,
      nickname: "ARK OCM Business leads: 75 included, then $5 each",
      component: "business_lead_overage",
      includedUnits: BUSINESS_INCLUDED_LEADS,
      overageCents: PER_OVERAGE_CENTS,
    });
    businessLeadOveragePriceId = price.id;
  }

  if (!conversationMeterId) {
    const meter = await createMeter(stripe, "ARK OCM Lead Conversations", CONVERSATION_METER_EVENT);
    conversationMeterId = meter.id;
  }
  if (!conversationProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Conversation Overage",
      description: "Plan-specific included new lead conversations followed by a $5 per-conversation overage. Messages inside one conversation are included.",
      metadata: { ark_billing_component: "conversation_overage", ark_billing_version: BILLING_VERSION },
    });
    conversationProductId = product.id;
  }
  if (!soloConversationOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: conversationProductId,
      meterId: conversationMeterId,
      nickname: "ARK OCM Solo Pro conversations: 50 included, then $5 each",
      component: "solo_conversation_overage",
      includedUnits: INCLUDED_CONVERSATIONS,
      overageCents: PER_OVERAGE_CENTS,
    });
    soloConversationOveragePriceId = price.id;
  }
  if (!businessConversationOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: conversationProductId,
      meterId: conversationMeterId,
      nickname: "ARK OCM Business conversations: 75 included, then $5 each",
      component: "business_conversation_overage",
      includedUnits: BUSINESS_INCLUDED_CONVERSATIONS,
      overageCents: PER_OVERAGE_CENTS,
    });
    businessConversationOveragePriceId = price.id;
  }

  if (!employeeMeterId) {
    const meter = await createMeter(stripe, "ARK OCM Active Business Employees", EMPLOYEE_METER_EVENT);
    employeeMeterId = meter.id;
  }
  if (!employeeProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Employee Seats",
      description: "Business includes 3 active employee accounts, then $25 per additional active employee each billing period.",
      metadata: { ark_billing_component: "employee_overage", ark_billing_version: BILLING_VERSION },
    });
    employeeProductId = product.id;
  }
  if (!employeeOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: employeeProductId,
      meterId: employeeMeterId,
      nickname: "ARK OCM employees: 3 included, then $25 each",
      component: "employee_overage",
      includedUnits: BUSINESS_INCLUDED_EMPLOYEES,
      overageCents: PER_EMPLOYEE_OVERAGE_CENTS,
    });
    employeeOveragePriceId = price.id;
  }

  await configRef.set({
    billingVersion: BILLING_VERSION,
    plansProductId,
    soloBasePriceId,
    soloProBasePriceId,
    businessBasePriceId,
    leadProductId,
    leadMeterId,
    leadEventName: LEAD_METER_EVENT,
    soloLeadOveragePriceId,
    businessLeadOveragePriceId,
    conversationProductId,
    conversationMeterId,
    conversationEventName: CONVERSATION_METER_EVENT,
    soloConversationOveragePriceId,
    businessConversationOveragePriceId,
    employeeProductId,
    employeeMeterId,
    employeeEventName: EMPLOYEE_METER_EVENT,
    employeeOveragePriceId,
    includedLeads: INCLUDED_LEADS,
    includedConversations: INCLUDED_CONVERSATIONS,
    businessIncludedLeads: BUSINESS_INCLUDED_LEADS,
    businessIncludedConversations: BUSINESS_INCLUDED_CONVERSATIONS,
    businessIncludedEmployees: BUSINESS_INCLUDED_EMPLOYEES,
    perOverageCents: PER_OVERAGE_CENTS,
    perEmployeeOverageCents: PER_EMPLOYEE_OVERAGE_CENTS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    soloBasePriceId,
    soloProBasePriceId,
    businessBasePriceId,
    soloLeadOveragePriceId,
    businessLeadOveragePriceId,
    soloConversationOveragePriceId,
    businessConversationOveragePriceId,
    employeeOveragePriceId,
  };
}

function expectedPriceIds(catalog, planKey) {
  if (planKey === "business") {
    return [
      catalog.businessBasePriceId,
      catalog.businessLeadOveragePriceId,
      catalog.businessConversationOveragePriceId,
      catalog.employeeOveragePriceId,
    ];
  }
  if (planKey === "solo_pro") {
    return [catalog.soloProBasePriceId, catalog.soloLeadOveragePriceId, catalog.soloConversationOveragePriceId];
  }
  return [catalog.soloBasePriceId, catalog.soloLeadOveragePriceId];
}

function subscriptionHasPrices(subscription, priceIds) {
  const existing = new Set((subscription?.items?.data || []).map((item) => text(item?.price?.id || item?.price)));
  return existing.size === priceIds.length && priceIds.every((priceId) => existing.has(priceId));
}

async function alignExistingSubscription({ stripe, subscription, priceIds, planKey, metadata }) {
  if (
    subscriptionHasPrices(subscription, priceIds)
    && text(subscription.metadata?.billingVersion) === BILLING_VERSION
    && normalizeBillingPlan(subscription.metadata?.billingPlan) === planKey
  ) {
    return subscription;
  }

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
  billingPlan,
  existingSubscriptionId,
}) {
  const planKey = normalizeBillingPlan(billingPlan);
  const plan = billingPlanDefinition(planKey);
  const catalog = await ensureStripeBillingCatalog({ stripe, db });
  const priceIds = expectedPriceIds(catalog, planKey);
  const metadata = {
    clientId,
    uid: text(uid),
    businessName: text(businessName),
    billingPlan: planKey,
    billingVersion: BILLING_VERSION,
  };

  const existing = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));
  const subscription = existing
    ? await alignExistingSubscription({ stripe, subscription: existing, priceIds, planKey, metadata })
    : await stripe.subscriptions.create({
      customer: customerId,
      default_payment_method: paymentMethodId || undefined,
      collection_method: "charge_automatically",
      items: priceIds.map((price) => ({ price })),
      payment_behavior: "error_if_incomplete",
      metadata,
    });

  const basePriceId = planKey === "business"
    ? catalog.businessBasePriceId
    : planKey === "solo_pro"
      ? catalog.soloProBasePriceId
      : catalog.soloBasePriceId;
  const leadPriceId = planKey === "business" ? catalog.businessLeadOveragePriceId : catalog.soloLeadOveragePriceId;
  const conversationPriceId = planKey === "business"
    ? catalog.businessConversationOveragePriceId
    : plan.conversationsEnabled
      ? catalog.soloConversationOveragePriceId
      : null;

  const update = {
    billingPlan: planKey,
    billingPlanName: plan.name,
    billingVersion: BILLING_VERSION,
    monthlyBaseCents: plan.monthlyBaseCents,
    includedLeads: plan.includedLeads,
    includedConversations: plan.includedConversations,
    includedEmployees: plan.includedEmployees,
    perOverageCents: PER_OVERAGE_CENTS,
    perEmployeeOverageCents: PER_EMPLOYEE_OVERAGE_CENTS,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: basePriceId,
    stripeLeadPriceId: leadPriceId,
    stripeConversationPriceId: conversationPriceId,
    stripeEmployeePriceId: plan.employeesEnabled ? catalog.employeeOveragePriceId : null,
    billingStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    db.collection("businesses").doc(clientId).set(update, { merge: true }),
    uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({
      BillingPlan: planKey,
      BillingPlanName: plan.name,
      BillingVersion: BILLING_VERSION,
      MonthlyBaseCents: plan.monthlyBaseCents,
      IncludedLeads: plan.includedLeads,
      IncludedConversations: plan.includedConversations,
      IncludedEmployees: plan.includedEmployees,
      PerOverageCents: PER_OVERAGE_CENTS,
      PerEmployeeOverageCents: PER_EMPLOYEE_OVERAGE_CENTS,
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
  const timestampMs = Number(occurredAt || Date.now());
  const timestamp = Math.floor(timestampMs / 1000);
  return stripe.billing.meterEvents.create({
    event_name: eventName,
    identifier,
    timestamp,
    payload: {
      stripe_customer_id: customerId,
      value: "1",
    },
  });
}

export async function reportBillableLead({ stripe, customerId, clientId, leadId, occurredAt }) {
  return reportMeterEvent({
    stripe,
    eventName: LEAD_METER_EVENT,
    identifier: usageIdentifier("ark-v2-lead", clientId, leadId),
    customerId,
    occurredAt,
  });
}

export async function reportBillableConversation({ stripe, customerId, clientId, conversationId, occurredAt }) {
  return reportMeterEvent({
    stripe,
    eventName: CONVERSATION_METER_EVENT,
    identifier: usageIdentifier("ark-v2-conversation", clientId, conversationId),
    customerId,
    occurredAt,
  });
}

export async function reportBillableEmployee({ stripe, customerId, clientId, employeeId, billingPeriodKey, occurredAt }) {
  return reportMeterEvent({
    stripe,
    eventName: EMPLOYEE_METER_EVENT,
    identifier: usageIdentifier("ark-v2-employee", clientId, `${billingPeriodKey}:${employeeId}`),
    customerId,
    occurredAt,
  });
}
