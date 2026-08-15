import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  BILLING_PLAN_KEY,
  BILLING_PLAN_NAME,
  BILLING_VERSION,
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CALL_CENTS,
  PER_CHAT_CENTS,
  PER_LEAD_CENTS,
  PER_MESSAGE_BUNDLE_CENTS,
} from "./billingPricing.js";
import { calendarMonthWindow, subscriptionPeriodWindow } from "./timeWindows.js";

export {
  BILLING_VERSION,
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CALL_CENTS,
  PER_CHAT_CENTS,
  PER_LEAD_CENTS,
  PER_MESSAGE_BUNDLE_CENTS,
};

// Compatibility names used by older UI/API code. There are no included usage units.
export const INCLUDED_LEADS = 0;
export const INCLUDED_CONVERSATIONS = 0;
export const BUSINESS_INCLUDED_LEADS = 0;
export const BUSINESS_INCLUDED_CONVERSATIONS = 0;
export const PER_OVERAGE_CENTS = PER_CALL_CENTS;
export const PER_MESSAGE_CONVERSATION_CENTS = PER_CHAT_CENTS;

export const LEAD_METER_EVENT = "ark_account_lead_v7";
export const MESSAGE_BUNDLE_METER_EVENT = "ark_account_message_bundle_v5";
export const CONVERSATION_METER_EVENT = "ark_account_chat_v6";
export const BILLABLE_LEAD_EVENT = LEAD_METER_EVENT;

export const BILLING_PLANS = Object.freeze({
  standard: Object.freeze({
    key: BILLING_PLAN_KEY,
    name: BILLING_PLAN_NAME,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    includedLeads: 0,
    includedConversations: 0,
    conversationsEnabled: true,
  }),
});

function text(value) { return String(value || "").trim(); }
export function normalizeBillingPlan() { return BILLING_PLAN_KEY; }
export function billingPlanDefinition() { return BILLING_PLANS.standard; }

export function missingStripeResource(error) {
  return Number(error?.statusCode || error?.status) === 404
    || text(error?.code).toLowerCase() === "resource_missing"
    || text(error?.raw?.code).toLowerCase() === "resource_missing";
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
  } catch (error) {
    if (missingStripeResource(error)) return null;
    throw error;
  }
}

async function findUsableCustomerSubscription(stripe, customerId, clientId) {
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.items.data.price"],
  });
  const active = (list?.data || []).filter(activeSubscription);
  return active.find((subscription) => text(subscription.metadata?.clientId) === text(clientId))
    || active.find((subscription) => text(subscription.metadata?.billingPlan) === BILLING_PLAN_KEY)
    || active[0]
    || null;
}

export async function resolveBillingWindow({ stripe, subscriptionId, timeZone, strictSubscription = false, from = new Date() }) {
  const fallback = calendarMonthWindow(timeZone, from);
  if (!subscriptionId) {
    if (strictSubscription) throw new Error("A Stripe subscription is required to determine the referral period.");
    return fallback;
  }
  if (!stripe) {
    if (strictSubscription) throw new Error("Stripe is required to determine the subscription period.");
    return fallback;
  }
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data"] });
    return subscriptionPeriodWindow(subscription, fallback);
  } catch (error) {
    if (strictSubscription) throw error;
    console.warn("Unable to read Stripe billing period; using the business calendar month", error);
    return fallback;
  }
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
    metadata: {
      ark_billing_component: component,
      ark_billing_version: BILLING_VERSION,
      unit_amount_cents: String(unitAmount),
    },
  });
}

export async function ensureStripeBillingCatalog({ stripe, db }) {
  const configRef = db.collection("systemConfig").doc("stripeOneAccountV8");
  const legacyConfigRef = db.collection("systemConfig").doc("stripeOneAccountV5");
  const [snapshot, legacySnapshot] = await Promise.all([configRef.get(), legacyConfigRef.get()]);
  const saved = snapshot.exists ? snapshot.data() : legacySnapshot.exists ? legacySnapshot.data() : {};
  let plansProductId = text(saved.plansProductId);
  let leadProductId = text(saved.leadProductId);
  let chatProductId = text(saved.chatProductId);
  let messageProductId = text(saved.messageProductId);
  let leadMeterId = text(saved.leadMeterId);
  let chatMeterId = text(saved.chatMeterId);
  let messageMeterId = text(saved.messageMeterId);
  let basePriceId = configuredPrice("STRIPE_ACCOUNT_BASE_PRICE_ID") || text(saved.basePriceId);
  let leadPriceId = configuredPrice("STRIPE_ACCOUNT_LEAD_PRICE_ID") || text(saved.leadPriceId);
  let chatPriceId = configuredPrice("STRIPE_ACCOUNT_CHAT_PRICE_ID") || text(saved.chatPriceId);
  let messagePriceId = configuredPrice("STRIPE_ACCOUNT_MESSAGE_PRICE_ID") || text(saved.messagePriceId);

  if (!basePriceId) throw new Error("STRIPE_ACCOUNT_BASE_PRICE_ID is required before recurring billing can start.");
  const basePrice = await stripe.prices.retrieve(basePriceId);
  const baseProductId = typeof basePrice.product === "string" ? basePrice.product : text(basePrice.product?.id);
  const configuredProductId = configuredPrice("STRIPE_ACCOUNT_PRODUCT_ID");
  if (
    basePrice.active === false
    || text(basePrice.currency).toLowerCase() !== "usd"
    || Number(basePrice.unit_amount) !== MONTHLY_BASE_CENTS
    || !basePrice.recurring
    || text(basePrice.recurring.interval) !== "month"
  ) throw new Error("STRIPE_ACCOUNT_BASE_PRICE_ID must be the active $50 USD monthly recurring Price.");
  if (!baseProductId || (configuredProductId && baseProductId !== configuredProductId)) {
    throw new Error("STRIPE_ACCOUNT_BASE_PRICE_ID does not belong to STRIPE_ACCOUNT_PRODUCT_ID.");
  }
  plansProductId = baseProductId;
  if (!leadMeterId) leadMeterId = (await createMeter(stripe, "ARK new leads", LEAD_METER_EVENT)).id;
  if (!chatMeterId) chatMeterId = (await createMeter(stripe, "ARK chats", CONVERSATION_METER_EVENT)).id;
  if (!messageMeterId) messageMeterId = (await createMeter(stripe, "ARK SMS parts", MESSAGE_BUNDLE_METER_EVENT)).id;
  if (!leadProductId) leadProductId = (await stripe.products.create({ name: "ARK new leads", description: "$2 for each new lead received during its billing period.", metadata: { ark_billing_component: "lead_usage", ark_billing_version: BILLING_VERSION } })).id;
  if (!chatProductId) chatProductId = (await stripe.products.create({ name: "ARK chats", description: "$1 when each new customer chat is created.", metadata: { ark_billing_component: "chat_usage", ark_billing_version: BILLING_VERSION } })).id;
  if (!messageProductId) messageProductId = (await stripe.products.create({ name: "ARK SMS usage", description: "$1 for each 50 inbound and outbound SMS parts.", metadata: { ark_billing_component: "message_usage", ark_billing_version: BILLING_VERSION } })).id;
  if (!leadPriceId) leadPriceId = (await createMeteredPrice({ stripe, productId: leadProductId, meterId: leadMeterId, nickname: "ARK leads at $2 each", component: "lead_usage", unitAmount: PER_LEAD_CENTS })).id;
  if (!chatPriceId) chatPriceId = (await createMeteredPrice({ stripe, productId: chatProductId, meterId: chatMeterId, nickname: "ARK chats at $1 each", component: "chat_usage", unitAmount: PER_CHAT_CENTS })).id;
  if (!messagePriceId) messagePriceId = (await createMeteredPrice({ stripe, productId: messageProductId, meterId: messageMeterId, nickname: "ARK SMS parts at $1 per 50 parts", component: "message_usage", unitAmount: PER_MESSAGE_BUNDLE_CENTS })).id;

  await configRef.set({
    billingVersion: BILLING_VERSION,
    plansProductId,
    basePriceId,
    leadProductId,
    leadMeterId,
    leadEventName: LEAD_METER_EVENT,
    leadPriceId,
    chatProductId,
    chatMeterId,
    chatEventName: CONVERSATION_METER_EVENT,
    chatPriceId,
    messageProductId,
    messageMeterId,
    messageEventName: MESSAGE_BUNDLE_METER_EVENT,
    messagePriceId,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    perLeadCents: PER_LEAD_CENTS,
    perChatCents: PER_CHAT_CENTS,
    perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
    messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { basePriceId, leadPriceId, chatPriceId, messagePriceId };
}

function expectedPriceIds(catalog) {
  return [catalog.basePriceId, catalog.leadPriceId, catalog.chatPriceId, catalog.messagePriceId];
}

function subscriptionHasPrices(subscription, priceIds) {
  const existing = new Set((subscription?.items?.data || []).map((item) => text(item?.price?.id || item?.price)));
  return existing.size === priceIds.length && priceIds.every((priceId) => existing.has(priceId));
}

async function alignExistingSubscription({ stripe, subscription, priceIds, metadata, paymentMethodId }) {
  const pricesMatch = subscriptionHasPrices(subscription, priceIds);
  const versionMatches = text(subscription.metadata?.billingVersion) === BILLING_VERSION;
  const currentPaymentMethod = text(subscription.default_payment_method?.id || subscription.default_payment_method);
  const paymentMatches = !paymentMethodId || currentPaymentMethod === paymentMethodId;
  if (pricesMatch && versionMatches && paymentMatches) return subscription;
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
    ...(paymentMethodId ? { default_payment_method: paymentMethodId } : {}),
  });
}

export async function ensureCustomerBillingSubscription({ stripe, db, clientId, customerId, paymentMethodId, businessName, uid, existingSubscriptionId, subscriptionIdempotencyKey = "", persist = true, createIfMissing = false }) {
  const catalog = await ensureStripeBillingCatalog({ stripe, db });
  const priceIds = expectedPriceIds(catalog);
  const metadata = {
    clientId,
    uid: text(uid),
    businessName: text(businessName),
    billingPlan: BILLING_PLAN_KEY,
    billingVersion: BILLING_VERSION,
  };
  if (paymentMethodId) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }
  const storedSubscription = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));
  const existing = storedSubscription
    || await findUsableCustomerSubscription(stripe, customerId, clientId);
  if (!existing && !createIfMissing) return null;
  const subscription = existing
    ? await alignExistingSubscription({ stripe, subscription: existing, priceIds, metadata, paymentMethodId })
    : await stripe.subscriptions.create({
      customer: customerId,
      default_payment_method: paymentMethodId || undefined,
      collection_method: "charge_automatically",
      items: priceIds.map((price) => ({ price })),
      payment_behavior: "error_if_incomplete",
      metadata,
    }, subscriptionIdempotencyKey ? { idempotencyKey: subscriptionIdempotencyKey } : undefined);

  const update = {
    billingPlan: BILLING_PLAN_KEY,
    billingPlanName: BILLING_PLAN_NAME,
    billingVersion: BILLING_VERSION,
    monthlyBaseCents: MONTHLY_BASE_CENTS,
    includedLeads: 0,
    includedConversations: 0,
    perLeadCents: PER_LEAD_CENTS,
    perCallCents: PER_LEAD_CENTS,
    perChatCents: PER_CHAT_CENTS,
    perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
    messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeBasePriceId: catalog.basePriceId,
    stripeLeadPriceId: catalog.leadPriceId,
    stripeChatPriceId: catalog.chatPriceId,
    stripeMessagePriceId: catalog.messagePriceId,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (persist) {
    await Promise.all([
      db.collection("businesses").doc(clientId).set(update, { merge: true }),
      uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
      db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({
        BillingPlan: BILLING_PLAN_KEY,
        BillingPlanName: BILLING_PLAN_NAME,
        BillingVersion: BILLING_VERSION,
        MonthlyBaseCents: MONTHLY_BASE_CENTS,
        IncludedLeads: 0,
        IncludedConversations: 0,
        PerLeadCents: PER_LEAD_CENTS,
        PerCallCents: PER_LEAD_CENTS,
        PerChatCents: PER_CHAT_CENTS,
        PerMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
        MessagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
        StripeSubscriptionId: subscription.id,
        StripeSubscriptionStatus: subscription.status,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
  }
  return subscription;
}

function paymentMethodLabel(paymentMethod) {
  const card = paymentMethod?.card;
  if (!card) return "Payment method saved in Stripe";
  const brand = text(card.brand || "Card");
  return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${text(card.last4)}`;
}

export async function refreshStoredPaymentMethod({ stripe, db, clientId, uid, customerId, subscriptionId, fallbackPaymentMethodId = "" }) {
  if (!customerId) return { paymentMethodId: text(fallbackPaymentMethodId), paymentMethodLabel: "" };
  const customer = await stripe.customers.retrieve(customerId);
  if (customer?.deleted) throw new Error("The Stripe customer was deleted.");
  const customerDefault = text(customer?.invoice_settings?.default_payment_method?.id || customer?.invoice_settings?.default_payment_method);
  let subscription = null;
  if (subscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
    }
  }
  const subscriptionDefault = text(subscription?.default_payment_method?.id || subscription?.default_payment_method);
  const fallback = text(fallbackPaymentMethodId);
  let paymentMethodId = customerDefault || subscriptionDefault || fallback;
  if (customerDefault && customerDefault !== fallback && subscriptionDefault === fallback) paymentMethodId = customerDefault;
  else if (subscriptionDefault && subscriptionDefault !== fallback) paymentMethodId = subscriptionDefault;
  if (!paymentMethodId) return { paymentMethodId: "", paymentMethodLabel: "" };

  if (customerDefault !== paymentMethodId) {
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  }
  if (subscription && subscriptionDefault !== paymentMethodId) {
    await stripe.subscriptions.update(subscription.id, { default_payment_method: paymentMethodId });
  }
  let paymentMethod = null;
  try {
    paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  } catch (error) {
    if (!missingStripeResource(error)) throw error;
  }
  const label = paymentMethodLabel(paymentMethod);
  const update = {
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethodId,
    paymentMethodLabel: label,
    paymentMethodSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await Promise.all([
    db.collection("businesses").doc(clientId).set(update, { merge: true }),
    uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({
      StripeCustomerId: customerId,
      StripePaymentMethodId: paymentMethodId,
      PaymentMethodLabel: label,
      PaymentMethodSyncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
  return { paymentMethodId, paymentMethodLabel: label };
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
  return reportMeterEvent({ stripe, eventName: LEAD_METER_EVENT, identifier: usageIdentifier("ark-v7-lead", clientId, leadId), customerId, occurredAt });
}

export async function reportBillableMessageBundles({ stripe, customerId, clientId, billingPeriodKey, bundleCount, occurredAt }) {
  if (!bundleCount) return null;
  return reportMeterEvent({ stripe, eventName: MESSAGE_BUNDLE_METER_EVENT, identifier: usageIdentifier("ark-v5-message-bundles", clientId, billingPeriodKey), customerId, occurredAt, value: bundleCount });
}

export async function reportBillableConversation({ stripe, customerId, clientId, conversationId, occurredAt }) {
  return reportMeterEvent({ stripe, eventName: CONVERSATION_METER_EVENT, identifier: usageIdentifier("ark-v6-chat", clientId, conversationId), customerId, occurredAt });
}

function billingUsageRecordId(clientId, sourceId) {
  return createHash("sha256").update(`${clientId}:${sourceId}`).digest("hex").slice(0, 48);
}

export async function syncStripeUsage({
  db,
  stripe,
  clientId,
  customerId,
  subscription,
  window,
  leads,
  conversations = [],
  messageUsage,
}) {
  const root = db.collection("ocmClients").doc(clientId);
  let leadsSynced = 0;
  for (const lead of leads) {
    const recordRef = root.collection("billingLeadEvents")
      .doc(text(lead.eventId) || billingUsageRecordId(clientId, lead.id));
    const record = await recordRef.get();
    if (record.exists && record.data().stripeReported === true) continue;
    await reportBillableLead({ stripe, customerId, clientId, leadId: lead.id, occurredAt: lead.occurredAt });
    await recordRef.set({
      leadId: lead.leadId,
      occurredAt: new Date(lead.occurredAt),
      stripeReported: true,
      stripePricingVersion: BILLING_VERSION,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      reportedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    leadsSynced += 1;
  }

  let chatsSynced = 0;
  for (const conversation of conversations) {
    const recordRef = root.collection("billingConversationEvents").doc(conversation.id);
    const record = await recordRef.get();
    if (record.exists && record.data().stripeReported === true) continue;
    await reportBillableConversation({
      stripe,
      customerId,
      clientId,
      conversationId: conversation.id,
      occurredAt: conversation.occurredAt,
    });
    await recordRef.set({
      conversationId: conversation.conversationId,
      occurredAt: new Date(conversation.occurredAt),
      stripeReported: true,
      stripePricingVersion: BILLING_VERSION,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      reportedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    chatsSynced += 1;
  }

  let messagePartsSynced = 0;
  const messagePartBlocks = Math.max(0, Number(messageUsage.blocks ?? messageUsage.bundles) || 0);
  if (messagePartBlocks > 0) {
    const recordRef = root.collection("billingMessageBundleEvents")
      .doc(billingUsageRecordId(clientId, window.monthKey));
    const record = await recordRef.get();
    const data = record.exists ? record.data() : {};
    const reportedBundles = data.stripeReported === true
      ? Math.max(0, Number(data.reportedBundleCount ?? data.bundleCount ?? 0))
      : 0;
    const additionalBundles = Math.max(0, messagePartBlocks - reportedBundles);
    if (additionalBundles > 0) {
      await reportBillableMessageBundles({
        stripe,
        customerId,
        clientId,
        billingPeriodKey: `${window.monthKey}:${messagePartBlocks}`,
        bundleCount: additionalBundles,
        occurredAt: Date.now(),
      });
      await recordRef.set({
        billingPeriodKey: window.monthKey,
        smsParts: messageUsage.parts,
        bundleCount: messagePartBlocks,
        partBlockCount: messagePartBlocks,
        reportedBundleCount: messagePartBlocks,
        stripeReported: true,
        stripePricingVersion: BILLING_VERSION,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        reportedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      messagePartsSynced = additionalBundles;
    }
  }

  return { leadsSynced, callsSynced: 0, chatsSynced, messagePartsSynced };
}
