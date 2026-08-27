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
  callEventDocumentId,
  callPlanStatus,
  recordCompletedCall,
} from "../app/lib/callPlanBilling.js";
import { messageContactBlockId, normalizeMessagePhone } from "../app/lib/messageContactBlocks.js";
import {
  ensureCustomerBillingSubscription,
  ensureStripePlanPrice,
  missingStripeResource,
  stripeBillingPlanFromSubscription,
} from "../app/lib/stripePlanBilling.js";

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

test("the four code-owned plans have the requested calls and monthly prices", () => {
  assert.deepEqual(
    publicBillingPlans().map(({ key, name, monthlyCalls, amountCents }) => ({ key, name, monthlyCalls, amountCents })),
    [
      { key: "starter", name: "Starter", monthlyCalls: 50, amountCents: 4999 },
      { key: "standard", name: "Standard", monthlyCalls: 100, amountCents: 7999 },
      { key: "growth", name: "Growth", monthlyCalls: 250, amountCents: 14999 },
      { key: "pro", name: "Pro", monthlyCalls: 500, amountCents: 29999 },
    ],
  );
  assert.equal(normalizeBillingPlanKey(" PRO "), "pro");
  assert.equal(normalizeBillingPlanKey("unknown"), "starter");
  assert.equal(billingPlanForAmount(7999), BILLING_PLANS.standard);
  assert.equal(billingPlan("growth").monthlyCalls, 250);
});

test("call IDs are deterministic and do not expose provider values", () => {
  const id = callEventDocumentId("sample-business", "provider-secret-call-id");
  assert.equal(id, callEventDocumentId("sample-business", "provider-secret-call-id"));
  assert.equal(id.length, 48);
  assert.equal(id.includes("provider-secret-call-id"), false);
});

test("completed-call recording is atomic and retries consume no additional calls", async () => {
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
    callPeriodStartAt: new Date(start),
    callPeriodEndAt: new Date(end),
    callPeriodKey: periodKey,
    callsUsedThisPeriod: 4,
  });

  const first = await recordCompletedCall({ db, clientId: "account-one", callId: "call-one", durationSeconds: 83 });
  const duplicate = await recordCompletedCall({ db, clientId: "account-one", callId: "call-one", durationSeconds: 83 });
  assert.equal(first.duplicate, false);
  assert.equal(first.callsUsed, 5);
  assert.equal(first.callsRemaining, 95);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.callsUsed, 5);
  assert.equal((await account.get()).data().callsUsedThisPeriod, 5);
});

test("a new provider billing period starts with the full allowance", () => {
  const now = Date.now();
  const status = callPlanStatus({
    billingPlanKey: "growth",
    callPeriodStartAt: new Date(now - 1_000),
    callPeriodEndAt: new Date(now + 1_000_000),
    callPeriodKey: "old-period",
    callsUsedThisPeriod: 249,
  }, new Date(now));
  assert.equal(status.callsUsed, 0);
  assert.equal(status.callsRemaining, 250);
  assert.equal(status.limitReached, false);
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
      unit_amount: 7999,
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
  assert.equal(created.params.unit_amount, 14999);
  assert.equal(created.params.lookup_key, "ark_client_center_growth_monthly_v3");
  assert.equal(created.params.product_data.name, "ARK Client Center Growth");
  assert.equal(created.options.idempotencyKey, created.params.lookup_key);
});

test("the Stripe line item wins over stale subscription metadata after a portal switch", () => {
  const plan = stripeBillingPlanFromSubscription({
    metadata: { billingPlan: "starter" },
    items: { data: [{ price: { unit_amount: 29999, metadata: { billingPlan: "pro" } } }] },
  });
  assert.equal(plan.key, "pro");
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
        unit_amount: 4999,
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
