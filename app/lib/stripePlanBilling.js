import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  BILLING_PLAN_KEYS,
  BILLING_VERSION,
  billingPlan,
  billingPlanForAmount,
  isBillingPlanKey,
  normalizeBillingPlanKey,
} from "./billingPricing.js";
import { billingPromotion, promotionBillingFields } from "./temporaryFeatures.js";
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
    || active.find((subscription) => isBillingPlanKey(subscription.metadata?.billingPlan))
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
  return `ark_client_center_${normalizeBillingPlanKey(planKey)}_monthly_v5`;
}

export async function ensureStripePlanPrice({ stripe, planKey }) {
  const plan = billingPlan(planKey);
  const environmentVariable = planEnvironmentVariable(plan.key);
  const configuredPriceId = text(process.env[environmentVariable]);
  if (configuredPriceId) {
    let configuredPrice;
    try {
      configuredPrice = await stripe.prices.retrieve(configuredPriceId);
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
      console.warn(`${environmentVariable} is stale for the current Stripe mode; using the code-managed ${plan.name} Price instead.`);
    }
    if (configuredPrice && isPriceForPlan(configuredPrice, plan.key)) {
      return { plan, priceId: configuredPrice.id, productId: priceId(configuredPrice.product) };
    }
    if (configuredPrice) console.warn(`${environmentVariable} has the retired amount; using the code-managed ${plan.name} Price instead.`);
  }

  const lookupKey = managedLookupKey(plan.key);
  const managedPrices = await stripe.prices.list({ active: true, lookup_keys: [lookupKey], limit: 10 });
  const managedPrice = managedPrices.data?.[0] || null;
  if (managedPrice && !isPriceForPlan(managedPrice, plan.key)) {
    throw new Error(`The code-managed Stripe ${plan.name} Price must remain $${plan.amountCents / 100} USD per month.`);
  }
  if (managedPrice) return { plan, priceId: managedPrice.id, productId: priceId(managedPrice.product) };

  const createdPrice = await stripe.prices.create({
    currency: "usd",
    unit_amount: plan.amountCents,
    recurring: { interval: "month", usage_type: "licensed" },
    lookup_key: lookupKey,
    nickname: `${plan.name}: ${plan.monthlyAcceptedLeads} monthly accepted leads`,
    metadata: {
      billingPlan: plan.key,
      billingVersion: BILLING_VERSION,
      monthlyAcceptedLeads: String(plan.monthlyAcceptedLeads),
      monthlyCalls: String(plan.monthlyCalls),
    },
    product_data: {
      name: `ARK Client Center ${plan.name}`,
      metadata: {
        billingPlan: plan.key,
        billingVersion: BILLING_VERSION,
        monthlyAcceptedLeads: String(plan.monthlyAcceptedLeads),
        monthlyCalls: String(plan.monthlyCalls),
      },
    },
  }, { idempotencyKey: lookupKey });
  if (!isPriceForPlan(createdPrice, plan.key)) throw new Error(`Stripe did not create the required ${plan.name} monthly Price.`);
  return { plan, priceId: createdPrice.id, productId: priceId(createdPrice.product) };
}

export async function ensureStripeBillingCatalog({ stripe, planKey = "starter" }) {
  return ensureStripePlanPrice({ stripe, planKey });
}

function portalProducts(catalog) {
  const products = new Map();
  for (const item of catalog) {
    if (!item.productId) throw new Error(`Stripe ${item.plan.name} Price is not attached to a Product.`);
    const prices = products.get(item.productId) || [];
    if (!prices.includes(item.priceId)) prices.push(item.priceId);
    products.set(item.productId, prices);
  }
  return [...products.entries()].map(([product, prices]) => ({ product, prices }));
}

function portalConfigurationFields({ appUrl, products }) {
  return {
    name: "ARK Client Center plans and payments",
    default_return_url: `${appUrl}/settings?section=payment`,
    business_profile: {
      headline: "Manage your ARK Client Center plan and payment method.",
      privacy_policy_url: `${appUrl}/privacy`,
      terms_of_service_url: `${appUrl}/terms`,
    },
    features: {
      customer_update: { enabled: false, allowed_updates: [] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products,
        proration_behavior: "none",
        billing_cycle_anchor: "unchanged",
      },
    },
    metadata: {
      managedBy: "ark-client-center",
      billingVersion: BILLING_VERSION,
    },
  };
}

async function configuredPortalConfiguration(stripe) {
  const configuredId = text(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID);
  if (!configuredId) return null;
  try {
    const configuration = await stripe.billingPortal.configurations.retrieve(configuredId);
    return configuration?.active === false ? null : configuration;
  } catch (error) {
    if (!missingStripeResource(error)) throw error;
    console.warn("STRIPE_BILLING_PORTAL_CONFIGURATION_ID is stale for the current Stripe mode; using ARK's managed portal configuration instead.");
    return null;
  }
}

async function managedPortalConfiguration(stripe) {
  const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  return (configurations.data || []).find((configuration) => text(configuration.metadata?.managedBy) === "ark-client-center") || null;
}

export async function ensureStripeBillingPortalConfiguration({ stripe, appUrl }) {
  const catalog = [];
  for (const planKey of BILLING_PLAN_KEYS) catalog.push(await ensureStripePlanPrice({ stripe, planKey }));
  const fields = portalConfigurationFields({ appUrl, products: portalProducts(catalog) });
  const existing = await configuredPortalConfiguration(stripe) || await managedPortalConfiguration(stripe);
  if (existing) return stripe.billingPortal.configurations.update(existing.id, fields);
  return stripe.billingPortal.configurations.create(fields, { idempotencyKey: "ark-client-center-billing-portal-v5" });
}

function validPromotionCoupon(coupon, promotion) {
  return Boolean(
    coupon
    && coupon.deleted !== true
    && coupon.valid !== false
    && Number(coupon.percent_off) === promotion.percentOff
    && text(coupon.duration) === "forever"
  );
}

export async function ensureStripePromotionCoupon({ stripe, promotionKey }) {
  const promotion = billingPromotion(promotionKey);
  if (!promotion) throw new Error("The requested billing promotion is not recognized.");
  try {
    const existing = await stripe.coupons.retrieve(promotion.stripeCouponId);
    if (!validPromotionCoupon(existing, promotion)) {
      throw new Error(`Stripe coupon ${promotion.stripeCouponId} must remain ${promotion.percentOff}% off forever.`);
    }
    return existing;
  } catch (error) {
    if (!missingStripeResource(error)) throw error;
  }

  const coupon = await stripe.coupons.create({
    id: promotion.stripeCouponId,
    name: `ARK ${promotion.label}`,
    percent_off: promotion.percentOff,
    duration: "forever",
    metadata: {
      billingPromotion: promotion.key,
      managedBy: "ark-client-center",
    },
  }, { idempotencyKey: `ark-promotion-coupon-${promotion.key}` });
  if (!validPromotionCoupon(coupon, promotion)) throw new Error("Stripe did not create the required website promotion coupon.");
  return coupon;
}

export function stripeBillingPlanFromSubscription(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  for (const item of items) {
    const price = item?.price;
    const priceMetadataPlan = text(price?.metadata?.billingPlan || price?.product?.metadata?.billingPlan);
    if (isBillingPlanKey(priceMetadataPlan)) return billingPlan(priceMetadataPlan);
    const amountPlan = billingPlanForAmount(price?.unit_amount);
    if (amountPlan) return amountPlan;
  }
  // Subscription metadata is a fallback. Stripe's customer portal can replace
  // the line-item Price without rewriting subscription metadata.
  const metadataPlan = text(subscription?.metadata?.billingPlan);
  if (isBillingPlanKey(metadataPlan)) return billingPlan(metadataPlan);
  return billingPlan();
}

function expectedPriceIds(catalog) {
  return [catalog.priceId];
}

function subscriptionHasPrices(subscription, priceIds) {
  const existing = new Set((subscription?.items?.data || []).map((item) => priceId(item?.price)));
  return existing.size === priceIds.length && priceIds.every((id) => existing.has(id));
}

async function alignExistingSubscription({ stripe, subscription, priceIds, metadata, paymentMethodId, promotionCoupon }) {
  const pricesMatch = subscriptionHasPrices(subscription, priceIds);
  const versionMatches = text(subscription.metadata?.billingVersion) === BILLING_VERSION;
  const planMatches = text(subscription.metadata?.billingPlan) === text(metadata.billingPlan);
  const currentPaymentMethod = priceId(subscription.default_payment_method);
  const paymentMatches = !paymentMethodId || currentPaymentMethod === paymentMethodId;
  const promotionMatches = !promotionCoupon
    || text(subscription.metadata?.billingPromotion) === text(metadata.billingPromotion);
  if (pricesMatch && versionMatches && planMatches && paymentMatches && promotionMatches) return subscription;

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
    ...(promotionCoupon ? { discounts: [{ coupon: promotionCoupon.id }] } : {}),
    expand: ["items.data.price"],
  });
}

function subscriptionBillingFields(subscription, timeZone, plan, promotion) {
  const fallback = calendarMonthWindow(timeZone);
  const period = subscriptionPeriodWindow(subscription, fallback);
  return {
    billingPlanKey: plan.key,
    billingPlanName: plan.name,
    monthlyAcceptedLeadLimit: plan.monthlyAcceptedLeads,
    monthlyCallLimit: plan.monthlyCalls,
    ...promotionBillingFields(plan, promotion),
    callPeriodStartAt: Timestamp.fromMillis(period.startMs),
    callPeriodEndAt: Timestamp.fromMillis(period.endMs),
    acceptedLeadPeriodStartAt: Timestamp.fromMillis(period.startMs),
    acceptedLeadPeriodEndAt: Timestamp.fromMillis(period.endMs),
  };
}

export function stripeSubscriptionAccountFields(subscription, account = {}) {
  const plan = stripeBillingPlanFromSubscription(subscription);
  const promotion = billingPromotion(subscription?.metadata?.billingPromotion || account.billingPromotionKey);
  const fallback = calendarMonthWindow(text(account.timeZone));
  const period = subscriptionPeriodWindow(subscription, fallback);
  const periodKey = `${period.startMs}-${period.endMs}`;
  const acceptedLeadsUsed = text(account.acceptedLeadPeriodKey) === periodKey
    ? Math.max(0, Number(account.acceptedLeadsUsedThisPeriod || 0))
    : 0;
  const acceptedLeadTopUps = text(account.acceptedLeadTopUpPeriodKey) === periodKey
    ? Math.max(0, Number(account.acceptedLeadTopUpsThisPeriod || 0))
    : 0;
  const acceptedLeadPeriodLimit = plan.monthlyAcceptedLeads + acceptedLeadTopUps;
  const callsUsed = text(account.callPeriodKey) === periodKey
    ? Math.max(0, Number(account.callsUsedThisPeriod || 0))
    : 0;
  const pendingPlanActivated = text(account.pendingBillingPlanKey) === plan.key;
  const patch = {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    billingPlanKey: plan.key,
    billingPlanName: plan.name,
    ...promotionBillingFields(plan, promotion),
    monthlyAcceptedLeadLimit: plan.monthlyAcceptedLeads,
    acceptedLeadPeriodLimit,
    acceptedLeadPeriodStartAt: Timestamp.fromMillis(period.startMs),
    acceptedLeadPeriodEndAt: Timestamp.fromMillis(period.endMs),
    acceptedLeadPeriodKey: periodKey,
    acceptedLeadsUsedThisPeriod: acceptedLeadsUsed,
    acceptedLeadsRemainingThisPeriod: Math.max(0, acceptedLeadPeriodLimit - acceptedLeadsUsed),
    acceptedLeadLimitReached: acceptedLeadsUsed >= acceptedLeadPeriodLimit,
    acceptedLeadTopUpPeriodKey: periodKey,
    acceptedLeadTopUpsThisPeriod: acceptedLeadTopUps,
    monthlyCallLimit: plan.monthlyCalls,
    callPeriodStartAt: Timestamp.fromMillis(period.startMs),
    callPeriodEndAt: Timestamp.fromMillis(period.endMs),
    callPeriodKey: periodKey,
    callsUsedThisPeriod: callsUsed,
    callsRemainingThisPeriod: Math.max(0, plan.monthlyCalls - callsUsed),
    callLimitReached: callsUsed >= plan.monthlyCalls,
    ...(pendingPlanActivated ? {
      pendingBillingPlanKey: FieldValue.delete(),
      pendingBillingPlanName: FieldValue.delete(),
      pendingBillingPlanStartsAt: FieldValue.delete(),
      pendingBillingPlanTiming: FieldValue.delete(),
      stripeSubscriptionScheduleId: FieldValue.delete(),
    } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  return { patch, plan, promotion, period, periodKey };
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
  promotionKey = "",
}) {
  const promotion = billingPromotion(promotionKey);
  if (text(promotionKey) && !promotion) throw new Error("The requested billing promotion is not recognized.");
  const catalog = await ensureStripeBillingCatalog({ stripe, planKey });
  const priceIds = expectedPriceIds(catalog);
  const plan = catalog.plan;
  const promotionCoupon = promotion
    ? await ensureStripePromotionCoupon({ stripe, promotionKey: promotion.key })
    : null;
  const metadata = {
    clientId,
    uid: text(uid),
    businessName: text(businessName),
    billingPlan: plan.key,
    billingVersion: BILLING_VERSION,
    monthlyAcceptedLeads: String(plan.monthlyAcceptedLeads),
    monthlyCalls: String(plan.monthlyCalls),
    ...(promotion ? {
      billingPromotion: promotion.key,
      billingDiscountPercent: String(promotion.percentOff),
      billingSalesChannel: "web",
    } : {}),
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
    ? await alignExistingSubscription({ stripe, subscription: existing, priceIds, metadata, paymentMethodId, promotionCoupon })
    : await stripe.subscriptions.create({
      customer: customerId,
      default_payment_method: paymentMethodId || undefined,
      collection_method: "charge_automatically",
      items: priceIds.map((price) => ({ price })),
      payment_behavior: "error_if_incomplete",
      metadata,
      ...(promotionCoupon ? { discounts: [{ coupon: promotionCoupon.id }] } : {}),
      expand: ["items.data.price"],
    }, subscriptionIdempotencyKey ? { idempotencyKey: subscriptionIdempotencyKey } : undefined);

  const update = {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    ...subscriptionBillingFields(subscription, timeZone, plan, promotion),
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
