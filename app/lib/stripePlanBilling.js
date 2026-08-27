import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  BILLING_PLAN_KEYS,
  BILLING_VERSION,
  billingPlan,
  billingPlanForAmount,
  normalizeBillingPlanKey,
} from "./billingPricing.js";
import { calendarMonthWindow, subscriptionPeriodWindow } from "./timeWindows.js";

function text(value) {
  return String(value || "").trim();
}

function priceId(value) {
  return text(value?.id || value);
}

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
    || active.find((subscription) => BILLING_PLAN_KEYS.includes(text(subscription.metadata?.billingPlan)))
    || active[0]
    || null;
}

export async function resolveBillingWindow({ stripe, subscriptionId, timeZone, strictSubscription = false, from = new Date() }) {
  const fallback = calendarMonthWindow(timeZone, from);
  if (!subscriptionId) {
    if (strictSubscription) throw new Error("A Stripe subscription is required to determine the billing period.");
    return fallback;
  }
  if (!stripe) {
    if (strictSubscription) throw new Error("Stripe is required to determine the billing period.");
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

function isPriceForPlan(price, planKey) {
  return isUsableMonthlyPrice(price) && Number(price.unit_amount) === billingPlan(planKey).amountCents;
}

function planEnvironmentVariable(planKey) {
  return `STRIPE_${normalizeBillingPlanKey(planKey).toUpperCase()}_PRICE_ID`;
}

function managedLookupKey(planKey) {
  return `ark_client_center_${normalizeBillingPlanKey(planKey)}_monthly_v3`;
}

function legacyStarterPriceId(planKey) {
  return normalizeBillingPlanKey(planKey) === "starter" ? text(process.env.STRIPE_ACCOUNT_BASE_PRICE_ID) : "";
}

export async function ensureStripePlanPrice({ stripe, planKey }) {
  const plan = billingPlan(planKey);
  const environmentVariable = planEnvironmentVariable(plan.key);
  const configuredPriceId = text(process.env[environmentVariable]) || legacyStarterPriceId(plan.key);
  if (configuredPriceId) {
    let configuredPrice;
    try {
      configuredPrice = await stripe.prices.retrieve(configuredPriceId);
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
      throw new Error(`${environmentVariable} was not found with the current Stripe secret key.`);
    }
    if (!isPriceForPlan(configuredPrice, plan.key)) {
      throw new Error(`${environmentVariable} must be an active $${plan.amountCents / 100} USD monthly recurring Price.`);
    }
    return { plan, priceId: configuredPrice.id };
  }

  const lookupKey = managedLookupKey(plan.key);
  const managedPrices = await stripe.prices.list({ active: true, lookup_keys: [lookupKey], limit: 10 });
  const managedPrice = managedPrices.data?.[0] || null;
  if (managedPrice && !isPriceForPlan(managedPrice, plan.key)) {
    throw new Error(`The code-managed Stripe ${plan.name} Price must remain $${plan.amountCents / 100} USD per month.`);
  }
  if (managedPrice) return { plan, priceId: managedPrice.id };

  const createdPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount: plan.amountCents,
    recurring: { interval: "month", usage_type: "licensed" },
    lookup_key: lookupKey,
    nickname: `${plan.name}: ${plan.monthlyCalls} monthly calls`,
    metadata: {
      billingPlan: plan.key,
      billingVersion: BILLING_VERSION,
      monthlyCalls: String(plan.monthlyCalls),
    },
    product_data: {
      name: `ARK Client Center ${plan.name}`,
      metadata: {
        billingPlan: plan.key,
        billingVersion: BILLING_VERSION,
        monthlyCalls: String(plan.monthlyCalls),
      },
    },
  }, { idempotencyKey: lookupKey });
  if (!isPriceForPlan(createdPrice, plan.key)) throw new Error(`Stripe did not create the required ${plan.name} monthly Price.`);
  return { plan, priceId: createdPrice.id };
}

export async function ensureStripeBillingCatalog({ stripe, planKey = "starter" }) {
  return ensureStripePlanPrice({ stripe, planKey });
}

export function stripeBillingPlanFromSubscription(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  for (const item of items) {
    const price = item?.price;
    const priceMetadataPlan = text(price?.metadata?.billingPlan || price?.product?.metadata?.billingPlan);
    if (BILLING_PLAN_KEYS.includes(priceMetadataPlan)) return billingPlan(priceMetadataPlan);
    const amountPlan = billingPlanForAmount(price?.unit_amount);
    if (amountPlan) return amountPlan;
  }
  // Subscription metadata is a fallback. Stripe's customer portal can replace
  // the line-item Price without rewriting subscription metadata.
  const metadataPlan = text(subscription?.metadata?.billingPlan);
  if (BILLING_PLAN_KEYS.includes(metadataPlan)) return billingPlan(metadataPlan);
  return billingPlan();
}

function expectedPriceIds(catalog) {
  return [catalog.priceId];
}

function subscriptionHasPrices(subscription, priceIds) {
  const existing = new Set((subscription?.items?.data || []).map((item) => priceId(item?.price)));
  return existing.size === priceIds.length && priceIds.every((id) => existing.has(id));
}

async function alignExistingSubscription({ stripe, subscription, priceIds, metadata, paymentMethodId }) {
  const pricesMatch = subscriptionHasPrices(subscription, priceIds);
  const versionMatches = text(subscription.metadata?.billingVersion) === BILLING_VERSION;
  const planMatches = text(subscription.metadata?.billingPlan) === text(metadata.billingPlan);
  const currentPaymentMethod = priceId(subscription.default_payment_method);
  const paymentMatches = !paymentMethodId || currentPaymentMethod === paymentMethodId;
  if (pricesMatch && versionMatches && planMatches && paymentMatches) return subscription;

  const existingItems = subscription.items?.data || [];
  const expected = new Set(priceIds);
  const items = [];
  for (const item of existingItems) {
    const existingPriceId = priceId(item?.price);
    if (expected.has(existingPriceId)) {
      items.push({ id: item.id });
      expected.delete(existingPriceId);
    } else {
      items.push({ id: item.id, deleted: true });
    }
  }
  for (const expectedPriceId of expected) items.push({ price: expectedPriceId });
  return stripe.subscriptions.update(subscription.id, {
    items,
    proration_behavior: "none",
    metadata,
    ...(paymentMethodId ? { default_payment_method: paymentMethodId } : {}),
    expand: ["items.data.price"],
  });
}

function subscriptionBillingFields(subscription, timeZone, plan) {
  const fallback = calendarMonthWindow(timeZone);
  const period = subscriptionPeriodWindow(subscription, fallback);
  return {
    billingPlanKey: plan.key,
    billingPlanName: plan.name,
    monthlyCallLimit: plan.monthlyCalls,
    monthlyPlanAmountCents: plan.amountCents,
    callPeriodStartAt: Timestamp.fromMillis(period.startMs),
    callPeriodEndAt: Timestamp.fromMillis(period.endMs),
  };
}

export async function ensureCustomerBillingSubscription({
  stripe,
  db,
  clientId,
  customerId,
  paymentMethodId,
  businessName,
  uid,
  planKey = "starter",
  timeZone = "America/New_York",
  existingSubscriptionId,
  subscriptionIdempotencyKey = "",
  persist = true,
  createIfMissing = false,
}) {
  const catalog = await ensureStripeBillingCatalog({ stripe, planKey });
  const priceIds = expectedPriceIds(catalog);
  const plan = catalog.plan;
  const metadata = {
    clientId,
    uid: text(uid),
    businessName: text(businessName),
    billingPlan: plan.key,
    billingVersion: BILLING_VERSION,
    monthlyCalls: String(plan.monthlyCalls),
  };
  if (paymentMethodId) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  const storedSubscription = await retrieveUsableSubscription(stripe, text(existingSubscriptionId));
  const existing = storedSubscription || await findUsableCustomerSubscription(stripe, customerId, clientId);
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
      expand: ["items.data.price"],
    }, subscriptionIdempotencyKey ? { idempotencyKey: subscriptionIdempotencyKey } : undefined);

  const update = {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    ...subscriptionBillingFields(subscription, timeZone, plan),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (persist) await db.collection("accounts").doc(clientId).set(update, { merge: true });
  return { subscription, plan, accountFields: update };
}

function paymentMethodLabel(paymentMethod) {
  const card = paymentMethod?.card;
  if (!card) return "Payment method saved in Stripe";
  const brand = text(card.brand || "Card");
  return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${text(card.last4)}`;
}

export async function refreshStoredPaymentMethod({ stripe, db, clientId, customerId, subscriptionId, fallbackPaymentMethodId = "" }) {
  if (!customerId) return { paymentMethodId: text(fallbackPaymentMethodId), paymentMethodLabel: "" };
  const customer = await stripe.customers.retrieve(customerId);
  if (customer?.deleted) throw new Error("The Stripe customer was deleted.");
  const customerDefault = priceId(customer?.invoice_settings?.default_payment_method);
  let subscription = null;
  if (subscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
    }
  }
  const subscriptionDefault = priceId(subscription?.default_payment_method);
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
  await db.collection("accounts").doc(clientId).set({
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethodId,
    paymentMethodLabel: label,
    paymentMethodSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { paymentMethodId, paymentMethodLabel: label };
}
