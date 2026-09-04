import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acceptedLeadTopUpRevenuePayment,
  appleTransactionRevenuePayment,
  normalizeRevenuePayment,
  revenuePaymentEventId,
  stripeInvoiceRevenuePayment,
  stripeTopUpRevenuePayment,
  syncRevenueLedger,
} from "../app/lib/revenueLedger.js";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("revenue payment IDs are stable across live delivery and reconciliation", () => {
  assert.equal(revenuePaymentEventId({ provider: "stripe", paymentKind: "subscription", paymentId: "in_123" }), "billing-paid-in_123");
  assert.equal(revenuePaymentEventId({ provider: "apple", paymentKind: "subscription", paymentId: "2000000123" }), "billing-paid-apple-2000000123");
  assert.equal(revenuePaymentEventId({ provider: "stripe", paymentKind: "accepted_lead_top_up", paymentId: "pi_123" }), "billing-paid-stripe-lead-top-up-pi_123");
});

test("invalid and zero-dollar records never enter the revenue ledger", () => {
  assert.equal(normalizeRevenuePayment({ provider: "stripe", paymentId: "in_1", clientId: "tabor", amountCents: 0, currency: "usd" }), null);
  assert.equal(normalizeRevenuePayment({ provider: "cash", paymentId: "cash_1", clientId: "tabor", amountCents: 2500, currency: "usd" }), null);
  assert.equal(normalizeRevenuePayment({ provider: "stripe", paymentId: "in_1", clientId: "", amountCents: 2500, currency: "usd" }), null);
});

test("Stripe reconciliation uses paid invoices and subscription metadata even before an account exists", () => {
  const payment = stripeInvoiceRevenuePayment({
    id: "in_signup",
    status: "paid",
    amount_paid: 2499,
    currency: "usd",
    created: 1_788_480_000,
    customer: "cus_signup",
    parent: { subscription_details: { subscription: "sub_signup", metadata: { clientId: "new-owner", businessName: "New Owner LLC" } } },
  });
  assert.deepEqual(payment, {
    eventId: "billing-paid-in_signup",
    provider: "stripe",
    paymentId: "in_signup",
    paymentKind: "subscription",
    clientId: "new-owner",
    businessName: "New Owner LLC",
    amountCents: 2499,
    currency: "usd",
    paidAt: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(stripeInvoiceRevenuePayment({ id: "in_open", status: "open", amount_paid: 2499 }, { clientId: "tabor" }), null);
});

test("only successful ARK lead top-ups are counted from Stripe", () => {
  const payment = stripeTopUpRevenuePayment({
    id: "pi_topup",
    status: "succeeded",
    amount_received: 500,
    currency: "usd",
    created: 1_788_480_000,
    metadata: { purpose: "accepted_lead_top_up", clientId: "tabor", businessName: "Tabor" },
  });
  assert.equal(payment.eventId, "billing-paid-stripe-lead-top-up-pi_topup");
  assert.equal(payment.amountCents, 500);
  assert.equal(stripeTopUpRevenuePayment({ ...payment, metadata: { purpose: "something_else" } }), null);
});

test("Apple and saved top-up records backfill exact amounts with plan fallback for legacy purchases", () => {
  const apple = appleTransactionRevenuePayment("apple_1", {
    clientId: "tabor",
    businessName: "Tabor",
    productId: "com.arkwebsites.app.growth.monthly",
    currency: "usd",
    purchaseDate: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(apple.amountCents, 8999);
  assert.equal(apple.eventId, "billing-paid-apple-apple_1");

  const topUp = acceptedLeadTopUpRevenuePayment({
    provider: "apple",
    paymentId: "apple_topup_1",
    clientId: "tabor",
    amountCents: 1000,
    currency: "usd",
    purchasedAt: "2026-09-04T00:00:00.000Z",
  }, { businessName: "Tabor" });
  assert.equal(topUp.eventId, "billing-paid-apple-lead-top-up-apple_topup_1");
  assert.equal(topUp.amountCents, 1000);
});

test("live payment paths and the daily workflow feed the same reconciled ledger", async () => {
  const [stripeWebhook, appleSignup, appleRenewal, topUps, cron, adminWebhook] = await Promise.all([
    source("app/api/billing/webhook/route.js"),
    source("app/lib/ownerApplePaymentSetup.js"),
    source("app/lib/appleIapTransactions.js"),
    source("app/lib/acceptedLeadTopUps.js"),
    source("app/api/cron/billing-sync/route.js"),
    source("app/api/webhooks/admin/route.js"),
  ]);
  for (const paymentPath of [stripeWebhook, appleSignup, appleRenewal, topUps]) assert.ok(paymentPath.includes("reportRevenuePayment"));
  assert.ok(cron.includes("syncRevenueLedger"));
  assert.ok(adminWebhook.includes('body.type) === "billing.revenue.sync"'));
});

class FakeDocumentSnapshot {
  constructor(reference, value) { this.reference = reference; this.value = value; }
  get id() { return this.reference.id; }
  get exists() { return this.value !== undefined; }
  data() { return this.value; }
}

class FakeDocumentReference {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new FakeCollectionReference(this.db, `${this.path}/${name}`); }
  async get() { return new FakeDocumentSnapshot(this, this.db.values.get(this.path)); }
  async set(value, options = {}) { this.db.write(this.path, value, options.merge === true); }
}

class FakeCollectionReference {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new FakeDocumentReference(this.db, `${this.path}/${id}`); }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.db.values.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => new FakeDocumentSnapshot(new FakeDocumentReference(this.db, path), value));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeFirestore {
  constructor(entries) { this.values = new Map(entries); }
  collection(name) { return new FakeCollectionReference(this, name); }
  write(path, value, merge) { this.values.set(path, merge ? { ...(this.values.get(path) || {}), ...value } : value); }
  async runTransaction(callback) {
    return callback({
      get: (reference) => reference.get(),
      set: (reference, value, options = {}) => this.write(reference.path, value, options.merge === true),
    });
  }
}

test("reconciliation paginates provider history, de-duplicates receipts, and exports a repairable ledger", async () => {
  const purchaseDate = { toMillis: () => Date.parse("2026-09-04T00:00:00.000Z") };
  const db = new FakeFirestore([
    ["accounts/tabor", { clientId: "tabor", businessName: "Tabor", stripeCustomerId: "cus_tabor" }],
    ["system/global/appleTransactions/apple_subscription", { clientId: "tabor", productId: "com.arkwebsites.app.starter.monthly", purchaseDate }],
    ["system/global/acceptedLeadTopUpPayments/stripe_receipt", { provider: "stripe", paymentId: "pi_topup", clientId: "tabor", amountCents: 500, currency: "usd", purchasedAt: purchaseDate }],
    ["system/global/acceptedLeadTopUpPayments/apple_receipt", { provider: "apple", paymentId: "apple_topup", clientId: "tabor", amountCents: 300, currency: "usd", purchasedAt: purchaseDate }],
  ]);
  const stripe = {
    invoices: {
      list: async ({ starting_after: startingAfter }) => startingAfter
        ? { data: [{ id: "in_zero", status: "paid", amount_paid: 0, currency: "usd", customer: "cus_tabor", created: 1_788_480_000 }], has_more: false }
        : { data: [{ id: "in_paid", status: "paid", amount_paid: 2499, currency: "usd", customer: "cus_tabor", subscription: "sub_tabor", created: 1_788_480_000 }], has_more: true },
    },
    paymentIntents: {
      list: async () => ({ data: [{ id: "pi_topup", status: "succeeded", amount_received: 500, currency: "usd", customer: "cus_tabor", created: 1_788_480_000, metadata: { purpose: "accepted_lead_top_up", clientId: "tabor" } }], has_more: false }),
    },
  };

  const first = await syncRevenueLedger({ db, stripe, includePayments: true, now: Date.parse("2026-09-04T01:00:00.000Z") });
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  assert.equal(first.paymentsFound, 4);
  assert.equal(first.payments.length, 4);
  assert.equal(db.values.get("system/global/paymentEvents/billing-paid-in_paid").amountCents, 2499);
  assert.equal(db.values.get("system/global/paymentEvents/billing-paid-stripe-lead-top-up-pi_topup").amountCents, 500);

  const second = await syncRevenueLedger({ db, stripe, includePayments: true, now: Date.now() });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "fresh");
  assert.equal(second.payments.length, 4);
});
