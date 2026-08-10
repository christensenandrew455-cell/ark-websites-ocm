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

test("a first payment failure advances on the exact quiet and grace deadlines", () => {
  const failedAt = Date.parse("2026-08-01T12:00:00.000Z");
  const account = { billingPastDue: true, billingOffenseNumber: 1, billingFailureAt: new Date(failedAt) };

  assert.equal(computeBillingState(account, failedAt + DAY_MS - 1).phase, "quiet");
  assert.equal(computeBillingState(account, failedAt + DAY_MS).phase, "grace");
  assert.equal(computeBillingState(account, failedAt + 8 * DAY_MS - 1).restricted, false);
  assert.equal(computeBillingState(account, failedAt + 8 * DAY_MS).phase, "restricted");
  assert.equal(computeBillingState(account, failedAt + 15 * DAY_MS).phase, "deletion-review");
});

test("a third payment incident reaches review after its quiet day", () => {
  const failedAt = Date.parse("2026-08-01T12:00:00.000Z");
  const account = { billingPastDue: true, billingOffenseNumber: 3, billingFailureAt: new Date(failedAt) };

  assert.equal(computeBillingState(account, failedAt + DAY_MS - 1).phase, "quiet");
  const review = computeBillingState(account, failedAt + DAY_MS);
  assert.equal(review.phase, "deletion-review");
  assert.equal(review.restricted, true);
  assert.equal(review.serviceAccess, "leads-only");
});
