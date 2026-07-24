import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_RECEPTIONIST_PLAN_KEY,
  RECEPTIONIST_PLANS,
  getReceptionistPlan,
  receptionistPlanSnapshot,
} from "./receptionistPricing";

export const BILLABLE_CALL_EVENT = "ark_billable_receptionist_call";
export const BILLABLE_LEAD_EVENT = BILLABLE_CALL_EVENT;
export const MONTHLY_BASE_CENTS = getReceptionistPlan(DEFAULT_RECEPTIONIST_PLAN_KEY).monthlyCents;
export const PER_CALL_OVERAGE_CENTS = getReceptionistPlan(DEFAULT_RECEPTIONIST_PLAN_KEY).overageCents;
export const PER_LEAD_CENTS = PER_CALL_OVERAGE_CENTS;

function text(value) {
  return String(value || "").trim();
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

function planEnvironmentKey(planKey, suffix) {
  return `STRIPE_RECEPTIONIST_${String(planKey || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
}

function configuredPlanPrice(planKey, suffix) {
  return text(process.env[planEnvironmentKey(planKey, suffix)]);
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configRef = db.collection("systemConfig").doc("stripeBilling");
  const snapshot = await configRef.get();
  const saved = snapshot.exists ? snapshot.data() : {};
  let baseProductId = text(saved.receptionistBaseProductId);
  let overageProductId = text(saved.receptionistOverageProductId);
  let callMeterId = text(saved.receptionistCallMeterId);
  const savedPlanPrices = saved.receptionistPlanPrices && typeof saved.receptionistPlanPrices === "object"
    ? saved.receptionistPlanPrices
    : {};

  if (!baseProductId) {
    const product = await stripe.products.create({
      name: "ARK AI Receptionist Plans",
      description: "Monthly ARK Client Center and AI receptionist service with an included completed-call allowance.",
      metadata: { ark_billing_component: "receptionist_monthly_plan" },
    });
    baseProductId = product.id;
  }

  if (!callMeterId) {
    const meter = await stripe.billing.meters.create({
      display_name: "ARK AI Receptionist Overage Calls",
      event_name: BILLABLE_CALL_EVENT,
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    });
    callMeterId = meter.id;
  }

  if (!overageProductId) {
    const product = await stripe.products.create({
      name: "ARK AI Receptionist Overage Calls",
      description: "Completed receptionist calls above the account's included monthly allowance.",
      metadata: { ark_billing_component: "receptionist_overage_call" },
    });
    overageProductId = product.id;
  }

  const planPrices = {};
  for (const plan of RECEPTIONIST_PLANS) {
    const savedPlan = savedPlanPrices[plan.key] || {};
    let basePriceId = configuredPlanPrice(plan.key, "BASE_PRICE_ID") || text(savedPlan.basePriceId);
    let overagePriceId = configuredPlanPrice(plan.key, "OVERAGE_PRICE_ID") || text(savedPlan.overagePriceId);

    if (!basePriceId) {
      const price = await stripe.prices.create({
        product: baseProductId,
        currency: "usd",
        unit_amount: plan.monthlyCents,
        recurring: { interval: "month" },
        nickname: `${plan.name} monthly service`,
        metadata: {
          ark_billing_component: "receptionist_monthly_plan",
          ark_plan_key: plan.key,
          ark_included_calls: String(plan.includedCalls),
        },
      });
      basePriceId = price.id;
    }

    if (!overagePriceId) {
      const price = await stripe.prices.create({
        product: overageProductId,
        currency: "usd",
        unit_amount: plan.overageCents,
        recurring: { interval: "month", usage_type: "metered", meter: callMeterId },
        nickname: `${plan.name} overage calls`,
        metadata: {
          ark_billing_component: "receptionist_overage_call",
          ark_plan_key: plan.key,
          ark_overage_cents: String(plan.overageCents),
        },
      });
      overagePriceId = price.id;
    }

    planPrices[plan.key] = { basePriceId, overagePriceId };
  }

  await configRef.set({
    receptionistBaseProductId: baseProductId,
    receptionistOverageProductId: overageProductId,
    receptionistCallMeterId: callMeterId,
    receptionistPlanPrices: planPrices,
    receptionistPlans: Object.fromEntries(RECEPTIONIST_PLANS.map((plan) => [plan.key, receptionistPlanSnapshot(plan.key)])),
    receptionistDefaultPlanKey: DEFAULT_RECEPTIONIST_PLAN_KEY,
    receptionistEventName: BILLABLE_CALL_EVENT,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { planPrices, callMeterId };
}

function subscriptionItemsForPlan(subscription, prices) {
  const currentItems = subscription?.items?.data || [];
  const updates = [];
  if (currentItems[0]) updates.push({ id: currentItems[0].id, price: prices.basePriceId });
  else updates.push({ price: prices.basePriceId });
  if (currentItems[1]) updates.push({ id: currentItems[1].id, price: prices.overagePriceId });
  else updates.push({ price: prices.overagePriceId });
  for (const extra of currentItems.slice(2)) updates.push({ id: extra.id, deleted: true });
  return updates;
}

async function persistSubscription({ db, clientId, uid, subscription, plan, prices }) {
  const update = {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: prices.basePriceId,
    stripeOveragePriceId: prices.overagePriceId,
    receptionistPlanKey: plan.key,
    receptionistPlanName: plan.name,
    receptionistIncludedCalls: plan.includedCalls,
    receptionistMonthlyCents: plan.monthlyCents,
    receptionistOverageCents: plan.overageCents,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await Promise.all([
    db.collection("businesses").doc(clientId).set(update, { merge: true }),
    uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({
      StripeSubscriptionId: subscription.id,
      StripeSubscriptionStatus: subscription.status,
      ReceptionistPlanKey: plan.key,
      ReceptionistPlanName: plan.name,
      ReceptionistIncludedCalls: plan.includedCalls,
      ReceptionistMonthlyCents: plan.monthlyCents,
      ReceptionistOverageCents: plan.overageCents,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
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
  planKey = DEFAULT_RECEPTIONIST_PLAN_KEY,
}) {
  const plan = getReceptionistPlan(planKey);
  const { planPrices } = await ensureStripeBillingCatalog({ stripe, db });
  const prices = planPrices[plan.key];
  let subscription = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));

  if (subscription) {
    const currentPriceIds = new Set((subscription.items?.data || []).map((item) => text(item.price?.id || item.price)));
    if (!currentPriceIds.has(prices.basePriceId) || !currentPriceIds.has(prices.overagePriceId)) {
      subscription = await stripe.subscriptions.update(subscription.id, {
        items: subscriptionItemsForPlan(subscription, prices),
        default_payment_method: paymentMethodId || undefined,
        proration_behavior: "none",
        metadata: {
          ...subscription.metadata,
          clientId,
          uid: text(uid),
          businessName: text(businessName),
          billingModel: "included-calls-plus-overage",
          receptionistPlanKey: plan.key,
        },
        expand: ["items.data.price"],
      });
    }
  } else {
    subscription = await stripe.subscriptions.create({
      customer: customerId,
      default_payment_method: paymentMethodId || undefined,
      collection_method: "charge_automatically",
      items: [{ price: prices.basePriceId }, { price: prices.overagePriceId }],
      payment_behavior: "error_if_incomplete",
      metadata: {
        clientId,
        uid: text(uid),
        businessName: text(businessName),
        billingModel: "included-calls-plus-overage",
        receptionistPlanKey: plan.key,
      },
      expand: ["items.data.price"],
    });
  }

  await persistSubscription({ db, clientId, uid, subscription, plan, prices });
  return subscription;
}

export async function reportBillableCall({ stripe, customerId, clientId, callId, occurredAt }) {
  const source = `${clientId}:${callId}`;
  const identifier = `ark-call-${createHash("sha256").update(source).digest("hex").slice(0, 48)}`;
  const timestampMs = Number(occurredAt || Date.now());
  const timestamp = Math.floor(timestampMs / 1000);

  return stripe.billing.meterEvents.create({
    event_name: BILLABLE_CALL_EVENT,
    identifier,
    timestamp,
    payload: {
      stripe_customer_id: customerId,
      value: "1",
    },
  });
}

export async function reportBillableLead({ stripe, customerId, clientId, leadId, occurredAt }) {
  return reportBillableCall({ stripe, customerId, clientId, callId: leadId, occurredAt });
}
