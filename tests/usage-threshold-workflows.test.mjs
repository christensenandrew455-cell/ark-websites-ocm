import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("usage charging reuses an uncertain Stripe attempt and reconciles accepted-lead ledgers", async () => {
  const [usage, cron, calls, acceptance, referrals, summary] = await Promise.all([
    source("app/lib/usageThresholdBilling.js"),
    source("app/api/cron/billing-sync/route.js"),
    source("app/api/receptionist/call-usage/route.js"),
    source("app/api/business/leads/accept/route.js"),
    source("app/lib/referrals.js"),
    source("app/api/billing/usage-summary/route.js"),
  ]);
  assert.ok(usage.includes('usageChargeStatus: "retry_pending"'));
  assert.ok(usage.includes('["processing", "retry_pending"].includes(status)'));
  assert.ok(usage.includes("usageChargePaymentMethodId"));
  assert.ok(usage.includes("idempotencyKey: `ark-usage-threshold-${claim.uid}-${claim.sequence}`"));
  assert.ok(usage.includes("const usagePrice = await ensureStripeUsagePrice({ stripe: client })"));
  assert.ok(usage.includes("amount: claim.amountCents"));
  assert.ok(usage.includes("activeReferralSavings({ db, clientId, now })"));
  assert.ok(usage.includes("usageChargeAfterReferralDiscount(fullAmountCents, discountPercent)"));
  assert.ok(usage.includes('type: "chat", points: 0'));
  assert.ok(usage.includes("usagePriceId: usagePrice.usagePriceId"));
  assert.ok(usage.includes("usageProductId: usagePrice.usageProductId"));
  assert.ok(usage.includes("reconcilePendingUsageEvents"));
  assert.ok(usage.includes("reconcileNonAcceptedLeadUsage"));
  assert.ok(usage.includes("LEAD_ACCEPTANCE_REQUIRED"));
  assert.ok(usage.includes('voidReason: NON_ACCEPTED_LEAD_VOID_REASON'));
  assert.ok(usage.includes('collection: "billingLeadEvents", type: "lead", points: 2'));
  assert.ok(usage.includes('collection: "billingConversationEvents", type: "chat", points: 0'));
  assert.ok(usage.includes('collection: "billingMessageEvents", type: "sms-parts", points: 0'));
  assert.ok(cron.includes("reconcilePendingUsageEvents({"));
  assert.ok(cron.includes("reconcileNonAcceptedLeadUsageBalances({"));
  assert.ok(cron.indexOf("reconcileNonAcceptedLeadUsageBalances({") < cron.indexOf("retryUsageThresholdCharges({"));
  assert.ok(summary.includes("reconcileNonAcceptedLeadUsage({"));
  assert.ok(cron.includes("retireLegacyReferralSubscriptionDiscounts({ db, stripe })"));
  assert.equal(referrals.includes("stripe.coupons.create"), false);
  assert.equal(calls.includes("recordLeadUsage({"), false);
  assert.ok(calls.includes("billingDeferredToAcceptance: true"));
  assert.ok(acceptance.includes("recordLeadUsage({"));
  assert.ok(acceptance.includes("ACCEPTED_LEAD_BILLING_SOURCE"));
  assert.ok(calls.includes("receptionist.call.completed"));
  assert.ok(calls.includes("sendAdminEvent"));
  assert.ok(usage.includes('type: "billing.payment_succeeded"'));
  assert.ok(usage.includes('paymentKind: "usage"'));
  assert.equal(calls.includes('collection("usage")'), false);
  assert.equal(calls.includes("monthKey"), false);
});

test("temporary signups reserve unique identity and remove Stripe data when abandoned", async () => {
  const [pending, signupDraft, completion] = await Promise.all([
    source("app/lib/pendingOwnerSignup.js"),
    source("app/api/signup/draft/route.js"),
    source("app/lib/ownerPaymentSetup.js"),
  ]);
  assert.ok(pending.includes("transaction.create(pendingRef, data)"));
  assert.equal(pending.includes("businessNameRegistry"), false);
  assert.equal(pending.includes("accountPhoneRegistry"), false);
  assert.ok(pending.includes("deletePendingStripeCustomer"));
  assert.ok(pending.includes("customers.del(customerId)"));
  assert.ok(signupDraft.includes("deletePendingOwnerSignup({"));
  assert.ok(completion.includes("batch.create(accountRef, accountData)"));
  assert.ok(completion.includes("batch.delete(pending.ref)"));
});

test("customer billing follows automatic daily retry and seven-day deletion with no local admin override", async () => {
  const [enforcement, delinquency, lifecycle, operations] = await Promise.all([
    source("app/api/workflows/billing-enforcement/route.js"),
    source("app/lib/billingDelinquency.js"),
    source("app/lib/customerLifecycle.js"),
    source(".github/workflows/ark-operations.yml"),
  ]);
  assert.ok(enforcement.includes("deleteCustomerPermanently(document.id)"));
  assert.ok(enforcement.includes("stripe.invoices.pay(invoiceId)"));
  assert.ok(delinquency.includes('status: "disabled"'));
  assert.ok(delinquency.includes('serviceAccess: "payment-update-only"'));
  assert.ok(delinquency.includes('status: "disabled"'));
  assert.ok(delinquency.includes("enabled: false"));
  assert.ok(delinquency.includes("receptionistEnabled: false"));
  assert.ok(lifecycle.includes('error.code = "PAYMENT_RESTRICTED"'));
  assert.ok(operations.includes('WORKFLOW_SECRET: ${{ secrets.CRON_SECRET }}'));
});
