import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const MONTHLY_BASE_CENTS = 10000;
export const PER_LEAD_CENTS = 1000;
export const BILLABLE_LEAD_EVENT = "ark_billable_lead";

function text(value) {
  return String(value || "").trim();
}

function activeSubscription(subscription) {
  return subscription && !["canceled", "incomplete_expired"].includes(subscription.status);
}

async function retrieveUsableSubscription(stripe, subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return activeSubscription(subscription) ? subscription : null;
  } catch {
    return null;
  }
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configuredBasePriceId = text(process.env.STRIPE_BASE_PRICE_ID);
  const configuredLeadPriceId = text(process.env.STRIPE_LEAD_PRICE_ID);
  if (configuredBasePriceId && configuredLeadPriceId) {
    return { basePriceId: configuredBasePriceId, leadPriceId: configuredLeadPriceId };
  }

  const configRef = db.collection("systemConfig").doc("stripeBilling");
  const snapshot = await configRef.get();
  const saved = snapshot.exists ? snapshot.data() : {};
  let basePriceId = configuredBasePriceId || text(saved.basePriceId);
  let leadPriceId = configuredLeadPriceId || text(saved.leadPriceId);
  let baseProductId = text(saved.baseProductId);
  let leadProductId = text(saved.leadProductId);
  let leadMeterId = text(saved.leadMeterId);

  if (!baseProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Monthly Service",
      description: "Monthly ARK Client Center, AI receptionist, phone, storage, maintenance, upkeep, testing, subscriptions, and labor service.",
      metadata: { ark_billing_component: "monthly_service" },
    });
    baseProductId = product.id;
  }

  if (!basePriceId) {
    const price = await stripe.prices.create({
      product: baseProductId,
      currency: "usd",
      unit_amount: MONTHLY_BASE_CENTS,
      recurring: { interval: "month" },
      nickname: "ARK OCM monthly service",
      metadata: { ark_billing_component: "monthly_service" },
    });
    basePriceId = price.id;
  }

  if (!leadMeterId) {
    const meter = await stripe.billing.meters.create({
      display_name: "ARK OCM Billable Leads",
      event_name: BILLABLE_LEAD_EVENT,
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    });
    leadMeterId = meter.id;
  }

  if (!leadProductId) {
    const product = await stripe.products.create({
      name: "ARK OCM Contacted Me Leads",
      description: "$10 for each unique lead added to Contacted Me.",
      metadata: { ark_billing_component: "billable_lead" },
    });
    leadProductId = product.id;
  }

  if (!leadPriceId) {
    const price = await stripe.prices.create({
      product: leadProductId,
      currency: "usd",
      unit_amount: PER_LEAD_CENTS,
      recurring: { interval: "month", usage_type: "metered", meter: leadMeterId },
      nickname: "ARK OCM per Contacted Me lead",
      metadata: { ark_billing_component: "billable_lead" },
    });
    leadPriceId = price.id;
  }

  await configRef.set({
    baseProductId,
    basePriceId,
    leadProductId,
    leadPriceId,
    leadMeterId,
    eventName: BILLABLE_LEAD_EVENT,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    perLeadCents: PER_LEAD_CENTS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { basePriceId, leadPriceId };
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
  const existing = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));
  if (existing) return existing;

  const { basePriceId, leadPriceId } = await ensureStripeBillingCatalog({ stripe, db });
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    default_payment_method: paymentMethodId || undefined,
    collection_method: "charge_automatically",
    items: [{ price: basePriceId }, { price: leadPriceId }],
    payment_behavior: "error_if_incomplete",
    metadata: {
      clientId,
      uid: text(uid),
      businessName: text(businessName),
      billingModel: "100-monthly-plus-10-per-contacted-lead",
    },
  });

  const update = {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: basePriceId,
    stripeLeadPriceId: leadPriceId,
    billingStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await Promise.all([
    db.collection("businesses").doc(clientId).set(update, { merge: true }),
    uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({
      StripeSubscriptionId: subscription.id,
      StripeSubscriptionStatus: subscription.status,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);

  return subscription;
}

export async function reportBillableLead({ stripe, customerId, clientId, leadId, occurredAt }) {
  const source = `${clientId}:${leadId}`;
  const identifier = `ark-lead-${createHash("sha256").update(source).digest("hex").slice(0, 48)}`;
  const timestampMs = Number(occurredAt || Date.now());
  const timestamp = Math.floor(timestampMs / 1000);

  return stripe.billing.meterEvents.create({
    event_name: BILLABLE_LEAD_EVENT,
    identifier,
    timestamp,
    payload: {
      stripe_customer_id: customerId,
      value: "1",
    },
  });
}
