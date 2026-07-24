import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const BILLING_VERSION = "solo-plans-v1";
export const INCLUDED_LEADS = 50;
export const INCLUDED_CONVERSATIONS = 50;
export const PER_OVERAGE_CENTS = 500;
export const LEAD_METER_EVENT = "ark_solo_plan_lead";
export const CONVERSATION_METER_EVENT = "ark_solo_plan_conversation";

export const BILLING_PLANS = Object.freeze({
  solo: Object.freeze({
    key: "solo",
    name: "Solo",
    monthlyBaseCents: 10000,
    includedLeads: INCLUDED_LEADS,
    includedConversations: 0,
    conversationsEnabled: false,
  }),
  solo_pro: Object.freeze({
    key: "solo_pro",
    name: "Solo Pro",
    monthlyBaseCents: 20000,
    includedLeads: INCLUDED_LEADS,
    includedConversations: INCLUDED_CONVERSATIONS,
    conversationsEnabled: true,
  }),
});

// Backward-compatible exports for any older imports that still exist elsewhere.
export const MONTHLY_BASE_CENTS = BILLING_PLANS.solo.monthlyBaseCents;
export const PER_LEAD_CENTS = PER_OVERAGE_CENTS;
export const BILLABLE_LEAD_EVENT = LEAD_METER_EVENT;

function text(value) {
  return String(value || "").trim();
}

export function normalizeBillingPlan(value) {
  return text(value).toLowerCase() === "solo_pro" ? "solo_pro" : "solo";
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

async function createTieredMeteredPrice({ stripe, productId, meterId, nickname, component }) {
  return stripe.prices.create({
    product: productId,
    currency: "usd",
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers: [
      { up_to: INCLUDED_LEADS, unit_amount: 0 },
      { up_to: "inf", unit_amount: PER_OVERAGE_CENTS },
    ],
    recurring: { interval: "month", usage_type: "metered", meter: meterId },
    nickname,
    metadata: {
      ark_billing_component: component,
      ark_billing_version: BILLING_VERSION,
      included_units: String(INCLUDED_LEADS),
      overage_cents: String(PER_OVERAGE_CENTS),
    },
  });
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configRef = db.collection("systemConfig").doc("stripeSoloPlansV1");
  const snapshot = await configRef.get();
  const saved = snapshot.exists ? snapshot.data() : {};

  let plansProductId = text(saved.plansProductId);
  let leadProductId = text(saved.leadProductId);
  let conversationProductId = text(saved.conversationProductId);
  let leadMeterId = text(saved.leadMeterId);
  let conversationMeterId = text(saved.conversationMeterId);

  let soloBasePriceId = configuredPrice("STRIPE_SOLO_BASE_PRICE_ID") || text(saved.soloBasePriceId);
  let soloProBasePriceId = configuredPrice("STRIPE_SOLO_PRO_BASE_PRICE_ID") || text(saved.soloProBasePriceId);
  let leadOveragePriceId = configuredPrice("STRIPE_SOLO_LEAD_PRICE_ID") || text(saved.leadOveragePriceId);
  let conversationOveragePriceId = configuredPrice("STRIPE_SOLO_CONVERSATION_PRICE_ID") || text(saved.conversationOveragePriceId);

  if (!plansProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Solo Plans",
      description: "ARK OCM Solo and Solo Pro monthly plans.",
      metadata: { ark_billing_component: "solo_plans", ark_billing_version: BILLING_VERSION },
    });
    plansProductId = product.id;
  }

  if (!soloBasePriceId) {
    const price = await stripe.prices.create({
      product: plansProductId,
      currency: "usd",
      unit_amount: BILLING_PLANS.solo.monthlyBaseCents,
      recurring: { interval: "month" },
      nickname: "ARK OCM Solo monthly plan",
      metadata: {
        ark_billing_component: "base_plan",
        ark_billing_plan: "solo",
        ark_billing_version: BILLING_VERSION,
      },
    });
    soloBasePriceId = price.id;
  }

  if (!soloProBasePriceId) {
    const price = await stripe.prices.create({
      product: plansProductId,
      currency: "usd",
      unit_amount: BILLING_PLANS.solo_pro.monthlyBaseCents,
      recurring: { interval: "month" },
      nickname: "ARK OCM Solo Pro monthly plan",
      metadata: {
        ark_billing_component: "base_plan",
        ark_billing_plan: "solo_pro",
        ark_billing_version: BILLING_VERSION,
      },
    });
    soloProBasePriceId = price.id;
  }

  if (!leadMeterId) {
    const meter = await createMeter(stripe, "ARK OCM Solo Plan Leads", LEAD_METER_EVENT);
    leadMeterId = meter.id;
  }

  if (!leadProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Lead Overage",
      description: "First 50 unique leads per billing month are included, then $5 per additional lead.",
      metadata: { ark_billing_component: "lead_overage", ark_billing_version: BILLING_VERSION },
    });
    leadProductId = product.id;
  }

  if (!leadOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: leadProductId,
      meterId: leadMeterId,
      nickname: "ARK OCM leads: 50 included, then $5 each",
      component: "lead_overage",
    });
    leadOveragePriceId = price.id;
  }

  if (!conversationMeterId) {
    const meter = await createMeter(stripe, "ARK OCM Solo Pro Conversations", CONVERSATION_METER_EVENT);
    conversationMeterId = meter.id;
  }

  if (!conversationProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Conversation Overage",
      description: "Solo Pro includes 50 new lead conversations per billing month, then $5 per additional conversation. Messages inside a conversation are included.",
      metadata: { ark_billing_component: "conversation_overage", ark_billing_version: BILLING_VERSION },
    });
    conversationProductId = product.id;
  }

  if (!conversationOveragePriceId) {
    const price = await createTieredMeteredPrice({
      stripe,
      productId: conversationProductId,
      meterId: conversationMeterId,
      nickname: "ARK OCM conversations: 50 included, then $5 each",
      component: "conversation_overage",
    });
    conversationOveragePriceId = price.id;
  }

  await configRef.set({
    billingVersion: BILLING_VERSION,
    plansProductId,
    soloBasePriceId,
    soloProBasePriceId,
    leadProductId,
    leadOveragePriceId,
    leadMeterId,
    leadEventName: LEAD_METER_EVENT,
    conversationProductId,
    conversationOveragePriceId,
    conversationMeterId,
    conversationEventName: CONVERSATION_METER_EVENT,
    includedLeads: INCLUDED_LEADS,
    includedConversations: INCLUDED_CONVERSATIONS,
    perOverageCents: PER_OVERAGE_CENTS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    soloBasePriceId,
    soloProBasePriceId,
    leadOveragePriceId,
    conversationOveragePriceId,
  };
}

function expectedPriceIds(catalog, planKey) {
  return planKey === "solo_pro"
    ? [catalog.soloProBasePriceId, catalog.leadOveragePriceId, catalog.conversationOveragePriceId]
    : [catalog.soloBasePriceId, catalog.leadOveragePriceId];
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

  const update = {
    billingPlan: planKey,
    billingPlanName: plan.name,
    billingVersion: BILLING_VERSION,
    monthlyBaseCents: plan.monthlyBaseCents,
    includedLeads: plan.includedLeads,
    includedConversations: plan.includedConversations,
    perOverageCents: PER_OVERAGE_CENTS,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: planKey === "solo_pro" ? catalog.soloProBasePriceId : catalog.soloBasePriceId,
    stripeLeadPriceId: catalog.leadOveragePriceId,
    stripeConversationPriceId: plan.conversationsEnabled ? catalog.conversationOveragePriceId : null,
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
      PerOverageCents: PER_OVERAGE_CENTS,
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
    identifier: usageIdentifier("ark-solo-v1-lead", clientId, leadId),
    customerId,
    occurredAt,
  });
}

export async function reportBillableConversation({ stripe, customerId, clientId, conversationId, occurredAt }) {
  return reportMeterEvent({
    stripe,
    eventName: CONVERSATION_METER_EVENT,
    identifier: usageIdentifier("ark-solo-v1-conversation", clientId, conversationId),
    customerId,
    occurredAt,
  });
}
