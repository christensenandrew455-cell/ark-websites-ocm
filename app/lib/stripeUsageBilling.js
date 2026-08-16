import { FieldValue } from "firebase-admin/firestore";
import {
  BILLING_PLAN_KEY,
  BILLING_VERSION,
  MONTHLY_BASE_CENTS,
} from "./billingPricing.js";
import { calendarMonthWindow, subscriptionPeriodWindow } from "./timeWindows.js";

function text(value) { return String(value || "").trim(); }

const BASE_PRICE_LOOKUP_KEY = "ark_client_center_base_monthly_v1";
const BASE_PRODUCT_NAME = "ARK Client Center Base Subscription";

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

function isUsableMonthlyPrice(price) {
  return Boolean(
    price
    && price.active !== false
    && text(price.currency).toLowerCase() === "usd"
    && Number.isInteger(Number(price.unit_amount))
    && Number(price.unit_amount) > 0
    && text(price.billing_scheme || "per_unit") === "per_unit"
    && text(price.type || "recurring") === "recurring"
    && text(price.recurring?.interval) === "month"
    && Number(price.recurring?.interval_count || 1) === 1
    && text(price.recurring?.usage_type || "licensed") === "licensed"
  );
}

function isMonthlyBasePrice(price) {
  return isUsableMonthlyPrice(price) && Number(price.unit_amount) === MONTHLY_BASE_CENTS;
}

export async function ensureStripeBillingCatalog({ stripe }) {
  const configuredPriceId = text(process.env.STRIPE_ACCOUNT_BASE_PRICE_ID);
  if (configuredPriceId) {
    let configuredPrice;
    try {
      configuredPrice = await stripe.prices.retrieve(configuredPriceId);
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
      throw new Error("STRIPE_ACCOUNT_BASE_PRICE_ID was not found with the current Stripe secret key.");
    }
    if (!isUsableMonthlyPrice(configuredPrice)) {
      throw new Error("STRIPE_ACCOUNT_BASE_PRICE_ID must be an active USD flat-rate monthly recurring Price.");
    }
    return { basePriceId: configuredPrice.id };
  }

  const managedPrices = await stripe.prices.list({
    active: true,
    lookup_keys: [BASE_PRICE_LOOKUP_KEY],
    limit: 10,
  });
  const managedPrice = managedPrices.data?.[0] || null;
  if (managedPrice && !isMonthlyBasePrice(managedPrice)) {
    throw new Error("The code-managed Stripe base Price must remain $50 USD per month.");
  }
  if (managedPrice) return { basePriceId: managedPrice.id };

  const existingPrices = await stripe.prices.list({
    active: true,
    currency: "usd",
    type: "recurring",
    recurring: { interval: "month" },
    limit: 100,
  });
  const existingPrice = (existingPrices.data || []).find(isMonthlyBasePrice);
  if (existingPrice) return { basePriceId: existingPrice.id };

  const createdPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount: MONTHLY_BASE_CENTS,
    recurring: { interval: "month", usage_type: "licensed" },
    lookup_key: BASE_PRICE_LOOKUP_KEY,
    nickname: "$50 monthly base subscription",
    metadata: { billingPlan: BILLING_PLAN_KEY, billingVersion: BILLING_VERSION },
    product_data: {
      name: BASE_PRODUCT_NAME,
      metadata: { billingPlan: BILLING_PLAN_KEY, billingVersion: BILLING_VERSION },
    },
  }, { idempotencyKey: BASE_PRICE_LOOKUP_KEY });
  if (!isMonthlyBasePrice(createdPrice)) throw new Error("Stripe did not create the required $50 monthly base Price.");
  return { basePriceId: createdPrice.id };
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
