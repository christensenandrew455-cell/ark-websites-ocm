import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("usage charging reuses an uncertain Stripe attempt and reconciles saved ledgers", async () => {
  const [usage, cron, calls] = await Promise.all([
    source("app/lib/usageThresholdBilling.js"),
    source("app/api/cron/billing-sync/route.js"),
    source("app/api/receptionist/call-usage/route.js"),
  ]);
  assert.ok(usage.includes('usageChargeStatus: "retry_pending"'));
  assert.ok(usage.includes('["processing", "retry_pending"].includes(status)'));
  assert.ok(usage.includes("usageChargePaymentMethodId"));
  assert.ok(usage.includes("idempotencyKey: `ark-usage-threshold-${claim.uid}-${claim.sequence}`"));
  assert.ok(usage.includes("amount: USAGE_CHARGE_THRESHOLD_POINTS * USAGE_POINT_CENTS"));
  assert.ok(usage.includes("reconcilePendingUsageEvents"));
  assert.ok(usage.includes('collection: "billingLeadEvents", type: "lead", points: 2'));
  assert.ok(usage.includes('collection: "billingConversationEvents", type: "chat", points: 1'));
  assert.ok(usage.includes('collection: "billingMessageEvents", type: "sms-parts", points: 0'));
  assert.ok(cron.includes("reconcilePendingUsageEvents({"));
  assert.ok(calls.includes("recordLeadUsage({"));
  assert.ok(calls.includes("billingLeadEventId(authorization.clientId, callId)"));
  assert.equal(calls.includes('collection("usage")'), false);
  assert.equal(calls.includes("monthKey"), false);
});

test("temporary signups reserve unique identity and remove Stripe data when abandoned", async () => {
  const [pending, signupDraft, completion] = await Promise.all([
    source("app/lib/pendingOwnerSignup.js"),
    source("app/api/signup/draft/route.js"),
    source("app/lib/ownerPaymentSetup.js"),
  ]);
  assert.ok(pending.includes('batch.create(db.collection("businessNameRegistry")'));
  assert.ok(pending.includes('batch.create(db.collection("accountPhoneRegistry")'));
  assert.ok(pending.includes("deletePendingStripeCustomer"));
  assert.ok(pending.includes("customers.del(customerId)"));
  assert.ok(signupDraft.includes("deletePendingOwnerSignup({"));
  assert.ok(completion.includes('status: "active", expiresAt: FieldValue.delete()'));
});

test("payment administration follows automatic daily retry and seven-day deletion only", async () => {
  const [api, page, enforcement, delinquency, lifecycle, operations] = await Promise.all([
    source("app/api/admin/payments/route.js"),
    source("app/payment/page.js"),
    source("app/api/workflows/billing-enforcement/route.js"),
    source("app/lib/billingDelinquency.js"),
    source("app/lib/customerLifecycle.js"),
    source(".github/workflows/ark-operations.yml"),
  ]);
  assert.ok(api.includes('item.phase === "payment_failed"'));
  assert.ok(api.includes('item.phase === "deletion_due"'));
  assert.equal(api.includes("export async function POST"), false);
  assert.equal(page.includes("Restore + 7 Days"), false);
  assert.equal(page.includes("Grace Period"), false);
  assert.ok(page.includes("retries no more than once per day"));
  assert.ok(enforcement.includes("deleteCustomerPermanently(document.id)"));
  assert.ok(enforcement.includes("stripe.invoices.pay(invoiceId)"));
  assert.ok(delinquency.includes('status: "disabled"'));
  assert.ok(delinquency.includes('serviceAccess: "payment-update-only"'));
  assert.ok(delinquency.includes("enabled: false, receptionistEnabled: false, paymentDisabled: true"));
  assert.ok(lifecycle.includes('error.code = "PAYMENT_RESTRICTED"'));
  assert.ok(operations.includes('WORKFLOW_SECRET: ${{ secrets.CRON_SECRET }}'));
});
