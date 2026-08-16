import assert from "node:assert/strict";
import test from "node:test";
import { computeBillingState } from "../app/lib/billingDelinquency.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("a current account is never restricted", () => {
  const state = computeBillingState({ billingPastDue: false }, Date.parse("2026-08-10T12:00:00.000Z"));
  assert.equal(state.phase, "current");
  assert.equal(state.restricted, false);
  assert.equal(state.serviceAccess, "full");
});

test("a payment failure pauses paid services immediately and is due for deletion at seven days", () => {
  const failedAt = Date.parse("2026-08-01T12:00:00.000Z");
  const account = { billingPastDue: true, billingFailureAt: new Date(failedAt) };

  const immediate = computeBillingState(account, failedAt);
  assert.equal(immediate.phase, "payment_failed");
  assert.equal(immediate.restricted, true);
  assert.equal(immediate.serviceAccess, "payment-update-only");
  assert.equal(computeBillingState(account, failedAt + 7 * DAY_MS - 1).phase, "payment_failed");
  assert.equal(computeBillingState(account, failedAt + 7 * DAY_MS).phase, "deletion_due");
});

test("a stored recovery deadline is authoritative", () => {
  const failedAt = Date.parse("2026-08-01T12:00:00.000Z");
  const deleteAt = failedAt + 3 * DAY_MS;
  const account = { billingPastDue: true, billingFailureAt: new Date(failedAt), billingDeleteAt: new Date(deleteAt) };
  assert.equal(computeBillingState(account, deleteAt - 1).phase, "payment_failed");
  assert.equal(computeBillingState(account, deleteAt).phase, "deletion_due");
});
