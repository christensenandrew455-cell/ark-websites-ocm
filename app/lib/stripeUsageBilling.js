import { FieldValue } from "firebase-admin/firestore";
import {
  BILLING_PLAN_KEY,
  BILLING_VERSION,
  MONTHLY_BASE_CENTS,
} from "./billingPricing.js";
import { calendarMonthWindow, subscriptionPeriodWindow } from "./timeWindows.js";

function text(value) { return String(value || "").trim(); }

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

export async function ensureStripeBillingCatalog({ stripe }) {
  const basePriceId = configuredPrice("STRIPE_ACCOUNT_BASE_PRICE_ID");

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
  return { basePriceId };
}

function expectedPriceIds(catalog) {
  return [catalog.basePriceId];
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
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (persist) {
    await db.collection("accounts").doc(clientId).set(update, { merge: true });
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
  await db.collection("accounts").doc(clientId).set(update, { merge: true });
  return { paymentMethodId, paymentMethodLabel: label };
}
