import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  BILLING_PLANS,
  billingPlan,
  billingPlanForAmount,
  normalizeBillingPlanKey,
  publicBillingPlans,
} from "../app/lib/billingPricing.js";
import {
  acceptedLeadEventDocumentId,
  acceptedLeadPlanStatus,
  nextAcceptedLeadPlanStatus,
} from "../app/lib/acceptedLeadPlanBilling.js";
import {
  acceptedLeadTopUpDocumentId,
  grantAcceptedLeadTopUp,
} from "../app/lib/acceptedLeadTopUps.js";
import {
  callEventDocumentId,
  recordCompletedCall,
} from "../app/lib/callPlanBilling.js";
import { messageContactBlockId, normalizeMessagePhone } from "../app/lib/messageContactBlocks.js";
import {
  ensureCustomerBillingSubscription,
  ensureStripeBillingPortalConfiguration,
  ensureStripePlanPrice,
  ensureStripePromotionCoupon,
  missingStripeResource,
  retrieveStripeAcceptedLeadTopUpPrice,
  stripeAcceptedLeadTopUpPaymentFields,
  stripeBillingPlanFromSubscription,
  stripeSubscriptionAccountFields,
} from "../app/lib/stripePlanBilling.js";
import {
  activeWebLaunchOffer,
  discountedAmountCents,
  isNativeClientCenterRequest,
  publicPromotion,
  TEMPORARY_FEATURES,
  webSignupPromotionForRequest,
} from "../app/lib/temporaryFeatures.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

async function withEnvironment(name, value, action) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

class MemorySnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.id = reference.id;
    this.exists = value !== undefined;
    this.value = value;
  }
  data() { return this.value; }
}

class MemoryDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }
  collection(name) { return new MemoryCollectionReference(this.db, `${this.path}/${name}`); }
  get() { return Promise.resolve(this.db.snapshot(this)); }
  set(value, options) { this.db.set(this, value, options); return Promise.resolve(); }
}

class MemoryCollectionReference {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new MemoryDocumentReference(this.db, `${this.path}/${id}`); }
}

class MemoryFirestore {
  constructor() { this.documents = new Map(); this.transactionTail = Promise.resolve(); }
  collection(name) { return new MemoryCollectionReference(this, name); }
  snapshot(reference) { return new MemorySnapshot(reference, this.documents.get(reference.path)); }
  set(reference, value, options = {}) {
    const current = this.documents.get(reference.path) || {};
    this.documents.set(reference.path, options.merge ? { ...current, ...value } : { ...value });
  }
  runTransaction(action) {
    const result = this.transactionTail.then(() => action({
      get: (reference) => Promise.resolve(this.snapshot(reference)),
      create: (reference, value) => {
        if (this.documents.has(reference.path)) throw new Error("already-exists");
        this.set(reference, value);
      },
      set: (reference, value, options) => this.set(reference, value, options),
    }));
    this.transactionTail = result.catch(() => undefined);
    return result;
  }
}

test("the four code-owned plans have the requested accepted leads and monthly prices", () => {
  assert.deepEqual(
    publicBillingPlans().map(({ key, name, positioning, monthlyAcceptedLeads, listAmountCents, amountCents, savingsPercent }) => ({ key, name, positioning, monthlyAcceptedLeads, listAmountCents, amountCents, savingsPercent })),
    [
      { key: "starter", name: "Starter", positioning: "Just getting going", monthlyAcceptedLeads: 25, listAmountCents: 2500, amountCents: 2499, savingsPercent: 0 },
      { key: "standard", name: "Standard", positioning: "Established small business", monthlyAcceptedLeads: 50, listAmountCents: 5000, amountCents: 4749, savingsPercent: 5 },
      { key: "growth", name: "Growth", positioning: "Higher-volume business", monthlyAcceptedLeads: 100, listAmountCents: 10000, amountCents: 8999, savingsPercent: 10 },
      { key: "scale", name: "Scale", positioning: "Very high lead volume", monthlyAcceptedLeads: 200, listAmountCents: 20000, amountCents: 16999, savingsPercent: 15 },
    ],
  );
  assert.equal(normalizeBillingPlanKey(" PRO "), "scale");
  assert.equal(normalizeBillingPlanKey("unknown"), "starter");
  assert.equal(billingPlanForAmount(4749), BILLING_PLANS.standard);
  assert.equal(billingPlanForAmount(29999), BILLING_PLANS.scale);
  assert.equal(billingPlan("growth").monthlyAcceptedLeads, 100);
});

test("the retired website offer is closed to new signups and preserves existing accounts", () => {
  const offer = TEMPORARY_FEATURES.webLaunchOffer;
  assert.equal(offer.key, "web-launch-half-off-v1");
  assert.equal(offer.percentOff, 50);
  assert.equal(offer.acceptingNewAccounts, false);
  assert.equal(activeWebLaunchOffer(), null);
  assert.deepEqual(
    publicBillingPlans().map((plan) => discountedAmountCents(plan.amountCents, offer)),
    [1250, 2375, 4500, 8500],
  );
  const websiteRequest = { headers: new Headers({ "user-agent": "Mozilla/5.0" }) };
  const nativeRequest = { headers: new Headers({ "user-agent": "Mozilla/5.0 ARKClientCenter/1.4" }) };
  assert.equal(isNativeClientCenterRequest(websiteRequest), false);
  assert.equal(isNativeClientCenterRequest(nativeRequest), true);
  assert.equal(webSignupPromotionForRequest(websiteRequest), null);
  assert.equal(webSignupPromotionForRequest(nativeRequest), null);
  assert.equal(webSignupPromotionForRequest(websiteRequest, offer.key)?.key, offer.key);
  assert.equal(webSignupPromotionForRequest(nativeRequest, offer.key)?.key, offer.key);
  assert.equal(publicPromotion(offer).renewsAtDiscount, true);
});

test("accepted-lead plan status reports a locked-in promotional account price", () => {
  const status = acceptedLeadPlanStatus({
    billingPlanKey: "starter",
    billingPromotionKey: "web-launch-half-off-v1",
    monthlyPlanListAmountCents: 2499,
    monthlyPlanAmountCents: 1250,
  });
  assert.equal(status.monthlyPriceCents, 1250);
  assert.equal(status.monthlyListPriceCents, 2499);
  assert.equal(status.billingDiscountPercent, 50);
});

test("call IDs are deterministic and do not expose provider values", () => {
  const id = callEventDocumentId("sample-business", "provider-secret-call-id");
  assert.equal(id, callEventDocumentId("sample-business", "provider-secret-call-id"));
  assert.equal(id.length, 48);
  assert.equal(id.includes("provider-secret-call-id"), false);
});

test("accepted-lead IDs are period-specific and do not expose lead values", () => {
  const id = acceptedLeadEventDocumentId("sample-business", "period-one", "private-lead-id");
  assert.equal(id, acceptedLeadEventDocumentId("sample-business", "period-one", "private-lead-id"));
  assert.notEqual(id, acceptedLeadEventDocumentId("sample-business", "period-two", "private-lead-id"));
  assert.equal(id.length, 48);
  assert.equal(id.includes("private-lead-id"), false);
});

test("completed-call recording is idempotent and does not consume accepted leads", async () => {
  const now = Date.now();
  const start = now - 24 * 60 * 60 * 1000;
  const end = now + 29 * 24 * 60 * 60 * 1000;
  const periodKey = `${start}-${end}`;
  const db = new MemoryFirestore();
  const account = db.collection("accounts").doc("account-one");
  await account.set({
    status: "active",
    billingPastDue: false,
    billingPlanKey: "standard",
    acceptedLeadPeriodStartAt: new Date(start),
    acceptedLeadPeriodEndAt: new Date(end),
    acceptedLeadPeriodKey: periodKey,
    acceptedLeadsUsedThisPeriod: 4,
  });

  const first = await recordCompletedCall({ db, clientId: "account-one", callId: "call-one", durationSeconds: 83 });
  const duplicate = await recordCompletedCall({ db, clientId: "account-one", callId: "call-one", durationSeconds: 83 });
  assert.equal(first.duplicate, false);
  assert.equal(first.acceptedLeadsUsed, 4);
  assert.equal(first.acceptedLeadsRemaining, 46);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.acceptedLeadsUsed, 4);
  assert.equal((await account.get()).data().acceptedLeadsUsedThisPeriod, 4);
});

test("accepting one lead advances the plan once and a new period starts full", () => {
  const now = Date.now();
  const status = acceptedLeadPlanStatus({
    billingPlanKey: "growth",
    acceptedLeadPeriodStartAt: new Date(now - 1_000),
    acceptedLeadPeriodEndAt: new Date(now + 1_000_000),
    acceptedLeadPeriodKey: "old-period",
    acceptedLeadsUsedThisPeriod: 99,
  }, new Date(now));
  assert.equal(status.acceptedLeadsUsed, 0);
  assert.equal(status.acceptedLeadsRemaining, 100);
  assert.equal(status.limitReached, false);
  const afterAcceptance = nextAcceptedLeadPlanStatus({ billingPlanKey: "growth" }, { existingAcceptedCount: 4, from: new Date(now) });
  assert.equal(afterAcceptance.acceptedLeadsUsed, 5);
  assert.equal(afterAcceptance.acceptedLeadsRemaining, 95);
});

test("top-up leads extend only the current period and never roll over", () => {
  const now = Date.now();
  const start = now - 1_000;
  const end = now + 1_000_000;
  const periodKey = `${start}-${end}`;
  const current = acceptedLeadPlanStatus({
    billingPlanKey: "starter",
    acceptedLeadPeriodStartAt: new Date(start),
    acceptedLeadPeriodEndAt: new Date(end),
    acceptedLeadPeriodKey: periodKey,
    acceptedLeadsUsedThisPeriod: 25,
    acceptedLeadTopUpPeriodKey: periodKey,
    acceptedLeadTopUpsThisPeriod: 20,
  }, new Date(now));
  assert.equal(current.monthlyAcceptedLeadLimit, 25);
  assert.equal(current.acceptedLeadTopUps, 20);
  assert.equal(current.acceptedLeadPeriodLimit, 45);
  assert.equal(current.acceptedLeadsRemaining, 20);

  const renewed = acceptedLeadPlanStatus({
    billingPlanKey: "starter",
    acceptedLeadPeriodStartAt: new Date(start),
    acceptedLeadPeriodEndAt: new Date(end),
    acceptedLeadPeriodKey: "prior-period",
    acceptedLeadsUsedThisPeriod: 25,
    acceptedLeadTopUpPeriodKey: "prior-period",
    acceptedLeadTopUpsThisPeriod: 20,
  }, new Date(now));
  assert.equal(renewed.acceptedLeadTopUps, 0);
  assert.equal(renewed.acceptedLeadPeriodLimit, 25);
  assert.equal(renewed.acceptedLeadsRemaining, 25);
});

test("a new Stripe billing period clears used and top-up leads instead of rolling them forward", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const subscription = {
    id: "sub_new_period",
    status: "active",
    metadata: { billingPlan: "standard" },
    items: { data: [{
      current_period_start: nowSeconds - 10,
      current_period_end: nowSeconds + 2_000,
      price: { unit_amount: 4749, metadata: { billingPlan: "standard" } },
    }] },
  };
  const result = stripeSubscriptionAccountFields(subscription, {
    billingPlanKey: "starter",
    acceptedLeadPeriodKey: "old-period",
    acceptedLeadsUsedThisPeriod: 25,
    acceptedLeadTopUpPeriodKey: "old-period",
    acceptedLeadTopUpsThisPeriod: 20,
    callPeriodKey: "old-period",
    callsUsedThisPeriod: 9,
  });
  assert.equal(result.patch.billingPlanKey, "standard");
  assert.equal(result.patch.monthlyAcceptedLeadLimit, 50);
  assert.equal(result.patch.acceptedLeadPeriodLimit, 50);
  assert.equal(result.patch.acceptedLeadsUsedThisPeriod, 0);
  assert.equal(result.patch.acceptedLeadTopUpsThisPeriod, 0);
  assert.equal(result.patch.acceptedLeadsRemainingThisPeriod, 50);
});

test("a paid top-up grants its exact quantity only once", async () => {
  const now = Date.now();
  const start = now - 1_000;
  const end = now + 1_000_000;
  const periodKey = `${start}-${end}`;
  const db = new MemoryFirestore();
  const account = db.collection("accounts").doc("top-up-account");
  await account.set({
    uid: "owner",
    businessName: "Top Up Business",
    status: "active",
    billingProvider: "stripe",
    billingPlanKey: "starter",
    acceptedLeadPeriodStartAt: new Date(start),
    acceptedLeadPeriodEndAt: new Date(end),
    acceptedLeadPeriodKey: periodKey,
    acceptedLeadsUsedThisPeriod: 25,
  });
  const first = await grantAcceptedLeadTopUp({
    db,
    clientId: "top-up-account",
    provider: "stripe",
    paymentId: "pi_paid_once",
    acceptedLeads: 20,
    amountCents: 2000,
  });
  const duplicate = await grantAcceptedLeadTopUp({
    db,
    clientId: "top-up-account",
    provider: "stripe",
    paymentId: "pi_paid_once",
    acceptedLeads: 20,
    amountCents: 2000,
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.acceptedLeadsAdded, 20);
  assert.equal(first.acceptedLeadsRemaining, 20);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await account.get()).data().acceptedLeadTopUpsThisPeriod, 20);
  assert.equal(acceptedLeadTopUpDocumentId("stripe", "pi_paid_once").length, 48);
});

test("Stripe validates a configured Price against the selected plan", async () => {
  let retrieved = "";
  const stripe = { prices: { async retrieve(id) {
    retrieved = id;
    return {
      id,
      active: true,
      billing_scheme: "per_unit",
      currency: "usd",
      unit_amount: 4749,
      type: "recurring",
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    };
  } } };
  const result = await withEnvironment("STRIPE_STANDARD_PRICE_ID", "price_standard", () => ensureStripePlanPrice({ stripe, planKey: "standard" }));
  assert.equal(retrieved, "price_standard");
  assert.equal(result.priceId, "price_standard");
  assert.equal(result.plan.key, "standard");
});

test("Stripe creates a stable code-managed Price when no override exists", async () => {
  let created;
  const stripe = { prices: {
    async list() { return { data: [] }; },
    async create(params, options) {
      created = { params, options };
      return {
        id: "price_growth",
        active: true,
        billing_scheme: "per_unit",
        currency: params.currency,
        unit_amount: params.unit_amount,
        type: "recurring",
        recurring: { ...params.recurring, interval_count: 1 },
      };
    },
  } };
  const result = await withEnvironment("STRIPE_GROWTH_PRICE_ID", undefined, () => ensureStripePlanPrice({ stripe, planKey: "growth" }));
  assert.equal(result.priceId, "price_growth");
  assert.equal(created.params.unit_amount, 8999);
  assert.equal(created.params.lookup_key, "ark_client_center_growth_monthly_v5");
  assert.equal(created.params.product_data.name, "ARK Client Center Growth");
  assert.equal(created.options.idempotencyKey, created.params.lookup_key);
});

test("Stripe reads the manually configured one-time $1 accepted-lead Price without creating one", async () => {
  let retrieved = "";
  let created = false;
  const stripe = { prices: {
    async retrieve(id) {
      retrieved = id;
      return {
        id,
        product: "prod_lead_top_up",
        active: true,
        billing_scheme: "per_unit",
        currency: "usd",
        unit_amount: 100,
        type: "one_time",
        recurring: null,
      };
    },
    async create() { created = true; },
  } };
  const result = await withEnvironment("STRIPE_ACCEPTED_LEAD_TOP_UP_PRICE_ID", "price_lead_top_up", () => retrieveStripeAcceptedLeadTopUpPrice({ stripe }));
  assert.equal(retrieved, "price_lead_top_up");
  assert.equal(result.priceId, "price_lead_top_up");
  assert.equal(result.unitAmountCents, 100);
  assert.equal(result.currency, "usd");
  assert.equal(created, false);
});

test("Stripe rejects an invalid accepted-lead top-up Price instead of creating a replacement", async () => {
  let created = false;
  const stripe = { prices: {
    async retrieve(id) {
      return {
        id,
        active: true,
        billing_scheme: "per_unit",
        currency: "usd",
        unit_amount: 99,
        type: "one_time",
        recurring: null,
      };
    },
    async create() { created = true; },
  } };
  await withEnvironment("STRIPE_ACCEPTED_LEAD_TOP_UP_PRICE_ID", "price_wrong_amount", () => assert.rejects(
    retrieveStripeAcceptedLeadTopUpPrice({ stripe }),
    /active, one-time \$1\.00 USD Price/,
  ));
  assert.equal(created, false);
});

test("Stripe top-up settlement is bound to the configured Price and its $1 unit amount", async () => {
  await withEnvironment("STRIPE_ACCEPTED_LEAD_TOP_UP_PRICE_ID", "price_lead_top_up", () => {
    const payment = stripeAcceptedLeadTopUpPaymentFields({
      amount_received: 300,
      currency: "usd",
      metadata: {
        purpose: "accepted_lead_top_up",
        acceptedLeads: "3",
        acceptedLeadTopUpPriceId: "price_lead_top_up",
        acceptedLeadUnitAmountCents: "100",
      },
    });
    assert.deepEqual(payment, {
      acceptedLeads: 3,
      unitAmountCents: 100,
      priceId: "price_lead_top_up",
      currency: "usd",
    });
    assert.throws(() => stripeAcceptedLeadTopUpPaymentFields({
      amount_received: 300,
      currency: "usd",
      metadata: {
        purpose: "accepted_lead_top_up",
        acceptedLeads: "3",
        acceptedLeadTopUpPriceId: "price_other",
        acceptedLeadUnitAmountCents: "100",
      },
    }), /STRIPE_ACCEPTED_LEAD_TOP_UP_PAYMENT_MISMATCH/);
  });
});

test("Stripe creates a usable billing portal with every current plan and payment-method updates", async () => {
  const planPrices = {
    ark_client_center_starter_monthly_v5: { id: "price_starter", product: "prod_starter", unit_amount: 2499 },
    ark_client_center_standard_monthly_v5: { id: "price_standard", product: "prod_standard", unit_amount: 4749 },
    ark_client_center_growth_monthly_v5: { id: "price_growth", product: "prod_growth", unit_amount: 8999 },
    ark_client_center_scale_monthly_v5: { id: "price_scale", product: "prod_scale", unit_amount: 16999 },
  };
  let createdConfiguration;
  const stripe = {
    prices: {
      async list({ lookup_keys: [lookupKey] }) {
        const price = planPrices[lookupKey];
        return { data: [{
          ...price,
          active: true,
          billing_scheme: "per_unit",
          currency: "usd",
          type: "recurring",
          recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
        }] };
      },
    },
    billingPortal: {
      configurations: {
        async list() { return { data: [] }; },
        async create(params, options) {
          createdConfiguration = { params, options };
          return { id: "bpc_ark", ...params };
        },
      },
    },
  };
  const result = await ensureStripeBillingPortalConfiguration({ stripe, appUrl: "https://www.arkclientcenter.com" });
  assert.equal(result.id, "bpc_ark");
  assert.equal(createdConfiguration.params.features.payment_method_update.enabled, true);
  assert.equal(createdConfiguration.params.features.subscription_update.enabled, true);
  assert.equal(createdConfiguration.params.features.subscription_update.proration_behavior, "none");
  assert.deepEqual(
    createdConfiguration.params.features.subscription_update.products.map(({ product, prices }) => ({ product, prices })),
    [
      { product: "prod_starter", prices: ["price_starter"] },
      { product: "prod_standard", prices: ["price_standard"] },
      { product: "prod_growth", prices: ["price_growth"] },
      { product: "prod_scale", prices: ["price_scale"] },
    ],
  );
  assert.equal(createdConfiguration.params.default_return_url, "https://www.arkclientcenter.com/settings?section=payment");
  assert.equal(createdConfiguration.options.idempotencyKey, "ark-client-center-billing-portal-v5");
});

test("Stripe preserves the explicit legacy website coupon for a grandfathered subscription", async () => {
  let couponCreate;
  let subscriptionCreate;
  const missing = new Error("missing");
  missing.code = "resource_missing";
  const stripe = {
    coupons: {
      async retrieve() { throw missing; },
      async create(params, options) {
        couponCreate = { params, options };
        return { id: params.id, valid: true, percent_off: params.percent_off, duration: params.duration };
      },
    },
    customers: { async update() {} },
    prices: { async retrieve(id) {
      return {
        id,
        active: true,
        billing_scheme: "per_unit",
        currency: "usd",
        unit_amount: 2499,
        type: "recurring",
        recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
      };
    } },
    subscriptions: {
      async list() { return { data: [] }; },
      async create(params) {
        subscriptionCreate = params;
        return { id: "sub_promotional", status: "active", metadata: params.metadata, items: { data: [] } };
      },
    },
  };
  const result = await withEnvironment("STRIPE_STARTER_PRICE_ID", "price_starter", () => ensureCustomerBillingSubscription({
    stripe,
    db: {},
    clientId: "client",
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    businessName: "Client",
    uid: "owner",
    planKey: "starter",
    promotionKey: "web-launch-half-off-v1",
    persist: false,
    createIfMissing: true,
  }));
  assert.equal(couponCreate.params.id, "ark_web_launch_half_off_v1");
  assert.equal(couponCreate.params.percent_off, 50);
  assert.equal(couponCreate.params.duration, "forever");
  assert.equal(subscriptionCreate.discounts[0].coupon, "ark_web_launch_half_off_v1");
  assert.equal(subscriptionCreate.metadata.billingPromotion, "web-launch-half-off-v1");
  assert.equal(result.accountFields.monthlyPlanAmountCents, 1250);
  assert.equal(result.accountFields.monthlyPlanListAmountCents, 2499);
  assert.equal(result.accountFields.billingDiscountPercent, 50);
  assert.equal((await ensureStripePromotionCoupon({ stripe: {
    coupons: { async retrieve() { return { id: "ark_web_launch_half_off_v1", valid: true, percent_off: 50, duration: "forever" }; } },
  }, promotionKey: "web-launch-half-off-v1" })).id, "ark_web_launch_half_off_v1");
});

test("the Stripe line item wins over stale subscription metadata after a portal switch", () => {
  const plan = stripeBillingPlanFromSubscription({
    metadata: { billingPlan: "starter" },
    items: { data: [{ price: { unit_amount: 29999, metadata: { billingPlan: "pro" } } }] },
  });
  assert.equal(plan.key, "scale");
});

test("a transient subscription lookup failure cannot create a duplicate", async () => {
  let creates = 0;
  const stripe = {
    customers: { async update() {} },
    prices: { async retrieve(id) {
      return {
        id,
        active: true,
        billing_scheme: "per_unit",
        currency: "usd",
        unit_amount: 2499,
        type: "recurring",
        recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
      };
    } },
    subscriptions: {
      async retrieve() { const error = new Error("temporary network failure"); error.code = "api_connection_error"; throw error; },
      async create() { creates += 1; return { id: "sub_duplicate", status: "active" }; },
    },
  };
  await withEnvironment("STRIPE_STARTER_PRICE_ID", "price_starter", () => assert.rejects(
    ensureCustomerBillingSubscription({
      stripe,
      db: {},
      clientId: "client",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      businessName: "Client",
      uid: "owner",
      existingSubscriptionId: "sub_existing",
      persist: false,
    }),
    /temporary network failure/,
  ));
  assert.equal(creates, 0);
});

test("only confirmed Stripe missing-resource responses are treated as missing", () => {
  assert.equal(missingStripeResource({ statusCode: 404 }), true);
  assert.equal(missingStripeResource({ code: "resource_missing" }), true);
  assert.equal(missingStripeResource({ statusCode: 503, code: "api_connection_error" }), false);
});

test("the custom Stripe manager requires explicit timing and full immediate payment", async () => {
  const [planRoute, topUpRoute, cardRoute, manager] = await Promise.all([
    source("app/api/billing/change-plan/route.js"),
    source("app/api/billing/top-up/route.js"),
    source("app/api/billing/payment-method/route.js"),
    source("app/components/PaymentManagementPanel.js"),
  ]);
  assert.ok(planRoute.includes('timing === "renewal"'));
  assert.ok(planRoute.includes('billing_cycle_anchor: "now"'));
  assert.ok(planRoute.includes('proration_behavior: "none"'));
  assert.ok(planRoute.includes('payment_behavior: "pending_if_incomplete"'));
  assert.ok(planRoute.includes("subscriptionSchedules.create"));
  assert.ok(planRoute.includes("subscriptionSchedules.update"));
  assert.ok(topUpRoute.includes("retrieveStripeAcceptedLeadTopUpPrice({ stripe })"));
  assert.ok(topUpRoute.includes("amount: acceptedLeads * topUpPrice.unitAmountCents"));
  assert.ok(topUpRoute.includes("acceptedLeadTopUpPriceId: topUpPrice.priceId"));
  assert.ok(topUpRoute.includes('purpose: "accepted_lead_top_up"'));
  assert.ok(cardRoute.includes("stripe.setupIntents.create"));
  assert.ok(cardRoute.includes("default_payment_method: paymentMethodId"));
  assert.ok(manager.includes("No charge today"));
  assert.ok(manager.includes("Unused leads expire. No refunds."));
  assert.ok(manager.includes("$1 each"));
});

test("retired variable-charge modules and routes are gone", async () => {
  const removed = [
    "app/lib/usageThresholdBilling.js",
    "app/lib/stripeUsageBilling.js",
    "app/lib/billingLeadUsage.js",
    "app/lib/billingMessageUsage.js",
    "app/lib/billingConversationUsage.js",
    "app/api/billing/usage-summary/route.js",
    "app/api/receptionist/call-usage/route.js",
  ];
  for (const path of removed) await assert.rejects(access(new URL(path, root)));
  const [accept, messages, intake] = await Promise.all([
    source("app/api/business/leads/accept/route.js"),
    source("app/api/business/lead-messages/route.js"),
    source("app/api/intake/route.js"),
  ]);
  for (const file of [accept, messages, intake]) {
    assert.equal(file.includes("recordUsage"), false);
    assert.equal(file.includes("recordLeadUsage"), false);
  }
});

test("deleted-chat contact blocks still normalize and hash phone numbers", () => {
  assert.equal(normalizeMessagePhone("(978) 660-3255"), "+19786603255");
  const id = messageContactBlockId("sample-business", "(978) 660-3255");
  assert.equal(id.length, 48);
  assert.equal(id.includes("9786603255"), false);
  assert.equal(id, messageContactBlockId("sample-business", "+1 978 660 3255"));
});
