import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MONTHLY_REFERRALS,
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CHAT_CENTS,
  PER_LEAD_CENTS,
  PER_MESSAGE_BUNDLE_CENTS,
  referralDiscountPercent,
  smsUsageResult,
  USAGE_CHARGE_THRESHOLD_POINTS,
  USAGE_POINT_CENTS,
  usageThresholdResult,
} from "../app/lib/billingPricing.js";
import {
  billingMessageEventData,
  billingMessageEventId,
} from "../app/lib/billingMessageUsage.js";
import { billingLeadEventId } from "../app/lib/billingLeadUsage.js";
import { billingConversationEventId, isBillableConversationData } from "../app/lib/billingConversationUsage.js";
import { messageContactBlockId, normalizeMessagePhone } from "../app/lib/messageContactBlocks.js";
import {
  ensureCustomerBillingSubscription,
  ensureStripeBillingCatalog,
  missingStripeResource,
} from "../app/lib/stripeUsageBilling.js";
import { referralDocumentId, referralPeriodDocumentId } from "../app/lib/referrals.js";

async function withBasePriceOverride(value, action) {
  const previous = process.env.STRIPE_ACCOUNT_BASE_PRICE_ID;
  if (value === undefined) delete process.env.STRIPE_ACCOUNT_BASE_PRICE_ID;
  else process.env.STRIPE_ACCOUNT_BASE_PRICE_ID = value;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env.STRIPE_ACCOUNT_BASE_PRICE_ID;
    else process.env.STRIPE_ACCOUNT_BASE_PRICE_ID = previous;
  }
}

test("billing prices live in code and usage charges at exact twenty-dollar intervals", () => {
  assert.equal(MONTHLY_BASE_CENTS, 5000);
  assert.equal(PER_LEAD_CENTS, 200);
  assert.equal(PER_CHAT_CENTS, 100);
  assert.equal(PER_MESSAGE_BUNDLE_CENTS, 100);
  assert.equal(MESSAGE_PARTS_PER_BUNDLE, 50);
  assert.equal(USAGE_CHARGE_THRESHOLD_POINTS, 20);
  assert.equal(USAGE_POINT_CENTS, 100);
});

test("SMS billing charges only when a rolling 50-part threshold is reached", () => {
  assert.deepEqual(smsUsageResult(0, 49), { addedPoints: 0, remainderParts: 49 });
  assert.deepEqual(smsUsageResult(49, 1), { addedPoints: 1, remainderParts: 0 });
  assert.deepEqual(smsUsageResult(30, 70), { addedPoints: 2, remainderParts: 0 });
  assert.deepEqual(smsUsageResult(40, 61), { addedPoints: 2, remainderParts: 1 });
});

test("usage charges exact twenty-point intervals and carries the remainder", () => {
  assert.deepEqual(usageThresholdResult(19, 1), { totalPoints: 20, chargeCount: 1, chargeDue: true, chargePoints: 20, remainderPoints: 0 });
  assert.deepEqual(usageThresholdResult(19, 2), { totalPoints: 21, chargeCount: 1, chargeDue: true, chargePoints: 20, remainderPoints: 1 });
  assert.deepEqual(usageThresholdResult(0, 42), { totalPoints: 42, chargeCount: 2, chargeDue: true, chargePoints: 40, remainderPoints: 2 });
});

test("referral savings are ten percent each and capped at five referrals", () => {
  assert.equal(MAX_MONTHLY_REFERRALS, 5);
  assert.equal(referralDiscountPercent(0), 0);
  assert.equal(referralDiscountPercent(3), 30);
  assert.equal(referralDiscountPercent(50), 50);
});

test("durable billing ledger IDs are deterministic and do not expose source values", () => {
  const messageId = billingMessageEventId("sample-business", "inbound", "provider-secret-id");
  assert.equal(messageId, billingMessageEventId("sample-business", "inbound", "provider-secret-id"));
  assert.equal(messageId.length, 48);
  assert.equal(messageId.includes("provider-secret-id"), false);
  const leadId = billingLeadEventId("sample-business", "lead-1");
  assert.equal(leadId, billingLeadEventId("sample-business", "lead-1"));
  assert.equal(leadId.length, 48);
  const chatId = billingConversationEventId("sample-business", "chat-1");
  assert.equal(chatId, billingConversationEventId("sample-business", "chat-1"));
  assert.equal(chatId.length, 48);
  assert.equal(referralDocumentId("one", "two"), referralDocumentId("one", "two"));
  assert.notEqual(referralPeriodDocumentId("one", "period-a"), referralPeriodDocumentId("one", "period-b"));
});

test("message billing records retain counts without message bodies or phone numbers", () => {
  const data = billingMessageEventData({
    direction: "outbound",
    smsParts: 3,
    sourceType: "conversation",
    occurredAt: Date.UTC(2026, 7, 10),
    body: "private message",
    phone: "+19785551212",
  });
  assert.equal(data.smsParts, 3);
  assert.equal(Object.hasOwn(data, "body"), false);
  assert.equal(Object.hasOwn(data, "phone"), false);
});

test("deleted-chat contact blocks normalize and hash phone numbers", () => {
  assert.equal(normalizeMessagePhone("(978) 660-3255"), "+19786603255");
  const id = messageContactBlockId("sample-business", "(978) 660-3255");
  assert.equal(id.length, 48);
  assert.equal(id.includes("9786603255"), false);
  assert.equal(id, messageContactBlockId("sample-business", "+1 978 660 3255"));
});

test("metadata-only conversation placeholders are not billed as chats", () => {
  assert.equal(isBillableConversationData({ updatedAt: new Date() }), false);
  assert.equal(isBillableConversationData({ createdAt: new Date() }), true);
  assert.equal(isBillableConversationData({ billingConversationSourceId: "chat:event" }), true);
});

test("only confirmed Stripe missing-resource responses are treated as missing", () => {
  assert.equal(missingStripeResource({ statusCode: 404 }), true);
  assert.equal(missingStripeResource({ code: "resource_missing" }), true);
  assert.equal(missingStripeResource({ statusCode: 503, code: "api_connection_error" }), false);
});

test("Stripe base billing accepts an optional monthly Price override", async () => {
  let retrievedId = "";
  const stripe = {
    prices: {
      async retrieve(priceId) {
        retrievedId = priceId;
        return {
          id: priceId,
          active: true,
          billing_scheme: "per_unit",
          currency: "usd",
          unit_amount: 1,
          type: "recurring",
          recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
        };
      },
      async list() { throw new Error("The catalog should not be searched when an override is set."); },
      async create() { throw new Error("A Price should not be created when an override is set."); },
    },
  };
  const result = await withBasePriceOverride(
    "price_owner_live_test",
    () => ensureStripeBillingCatalog({ stripe })
  );
  assert.deepEqual(result, { basePriceId: "price_owner_live_test" });
  assert.equal(retrievedId, "price_owner_live_test");
});

test("Stripe base billing resolves from the fixed code price without an override", async () => {
  const calls = [];
  const stripe = {
    prices: {
      async list(params) {
        calls.push(params);
        if (params.lookup_keys) return { data: [] };
        return {
          data: [{
            id: "price_existing_base",
            active: true,
            currency: "usd",
            unit_amount: 5000,
            type: "recurring",
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          }],
        };
      },
      async create() { throw new Error("An existing $50 monthly Price should be reused."); },
    },
  };
  assert.deepEqual(
    await withBasePriceOverride(undefined, () => ensureStripeBillingCatalog({ stripe })),
    { basePriceId: "price_existing_base" }
  );
  assert.equal(calls.length, 2);
});

test("Stripe base billing creates the fixed code price when the account has none", async () => {
  let created = null;
  const stripe = {
    prices: {
      async list() { return { data: [] }; },
      async create(params, options) {
        created = { params, options };
        return {
          id: "price_created_base",
          active: true,
          currency: params.currency,
          unit_amount: params.unit_amount,
          type: "recurring",
          recurring: { ...params.recurring, interval_count: 1 },
        };
      },
    },
  };
  assert.deepEqual(
    await withBasePriceOverride(undefined, () => ensureStripeBillingCatalog({ stripe })),
    { basePriceId: "price_created_base" }
  );
  assert.equal(created.params.unit_amount, 5000);
  assert.equal(created.params.recurring.interval, "month");
  assert.equal(created.params.product_data.name, "ARK Client Center Base Subscription");
  assert.equal(created.options.idempotencyKey, created.params.lookup_key);
});

test("a transient subscription lookup failure cannot create a duplicate subscription", async () => {
  let creates = 0;
  const db = {};
  const stripe = {
    customers: { async update() {} },
    prices: {
      async list() {
        return {
          data: [{
            id: "price_base",
            active: true,
            currency: "usd",
            unit_amount: 5000,
            type: "recurring",
            recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          }],
        };
      },
    },
    subscriptions: {
      async retrieve() {
        const error = new Error("temporary network failure");
        error.code = "api_connection_error";
        throw error;
      },
      async create() { creates += 1; return { id: "sub_duplicate", status: "active" }; },
    },
  };
  await withBasePriceOverride(
    undefined,
    () => assert.rejects(
      ensureCustomerBillingSubscription({
        stripe,
        db,
        clientId: "client",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        businessName: "Client",
        uid: "owner",
        existingSubscriptionId: "sub_existing",
        persist: false,
      }),
      /temporary network failure/
    )
  );
  assert.equal(creates, 0);
});
