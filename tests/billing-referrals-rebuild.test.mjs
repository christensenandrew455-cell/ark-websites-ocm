import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MONTHLY_REFERRALS,
  calculateBillingSummary,
  messageBundleCount,
  messagePartBlocksCrossed,
  referralDiscountPercent,
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
  missingStripeResource,
} from "../app/lib/stripeUsageBilling.js";
import { referralDocumentId, referralPeriodDocumentId } from "../app/lib/referrals.js";

test("billing uses exact base, lead, chat, and completed SMS-part block prices", () => {
  const summary = calculateBillingSummary({
    leadCount: 4,
    chatCount: 3,
    messagePartCount: 51,
    messagePartBlockCount: 1,
    messagePartRemainder: 1,
    messageCount: 7,
  });
  assert.equal(summary.monthlyBaseCents, 5000);
  assert.equal(summary.leadUsageCents, 800);
  assert.equal(summary.chatUsageCents, 300);
  assert.equal(summary.messagePartBlockCount, 1);
  assert.equal(summary.messagePartRemainder, 1);
  assert.equal(summary.messagePartUsageCents, 100);
  assert.equal(summary.messageUsageCents, 400);
  assert.equal(summary.subtotalCents, 6200);
  assert.equal(summary.amountDue, 6200);
});

test("SMS billing charges only when a rolling 50-part threshold is reached", () => {
  assert.equal(messageBundleCount(0), 0);
  assert.equal(messageBundleCount(1), 0);
  assert.equal(messageBundleCount(49), 0);
  assert.equal(messageBundleCount(50), 1);
  assert.equal(messageBundleCount(51), 1);
  assert.equal(messageBundleCount(100), 2);
  assert.equal(messagePartBlocksCrossed(30, 49), 0);
  assert.equal(messagePartBlocksCrossed(30, 50), 1);
  assert.equal(messagePartBlocksCrossed(90, 151), 2);
});

test("referral savings are ten percent each and capped at five referrals", () => {
  assert.equal(MAX_MONTHLY_REFERRALS, 5);
  assert.equal(referralDiscountPercent(0), 0);
  assert.equal(referralDiscountPercent(3), 30);
  assert.equal(referralDiscountPercent(50), 50);
  const summary = calculateBillingSummary({ leadCount: 1, referralCount: 5 });
  assert.equal(summary.subtotalCents, 5200);
  assert.equal(summary.referralSavingsCents, 2600);
  assert.equal(summary.amountDue, 2600);
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

test("a transient subscription lookup failure cannot create a duplicate subscription", async () => {
  let creates = 0;
  const catalog = {
    plansProductId: "prod_base",
    basePriceId: "price_base",
    leadProductId: "prod_lead",
    leadMeterId: "meter_lead",
    leadPriceId: "price_lead",
    chatProductId: "prod_chat",
    chatMeterId: "meter_chat",
    chatPriceId: "price_chat",
    messageProductId: "prod_message",
    messageMeterId: "meter_message",
    messagePriceId: "price_message",
  };
  const configDocument = {
    async get() { return { exists: true, data: () => catalog }; },
    async set() {},
  };
  const db = {
    collection(name) {
      assert.equal(name, "systemConfig");
      return { doc() { return configDocument; } };
    },
  };
  const stripe = {
    customers: { async update() {} },
    prices: {
      async retrieve(id) {
        return { id, active: true, currency: "usd", unit_amount: 5000, recurring: { interval: "month" }, product: "prod_base" };
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
  await assert.rejects(
    ensureCustomerBillingSubscription({
      stripe,
      db,
      clientId: "client",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      businessName: "Client",
      uid: "owner",
      existingSubscriptionId: "sub_existing",
    }),
    /temporary network failure/
  );
  assert.equal(creates, 0);
});
