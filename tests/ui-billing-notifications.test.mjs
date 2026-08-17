import assert from "node:assert/strict";
import test from "node:test";
import { PUSH_NOTIFICATION_COPY } from "../app/lib/notificationCopy.js";

test("phone notifications use short generic account-safe copy", () => {
  assert.equal(PUSH_NOTIFICATION_COPY.lead.title, "New lead");
  assert.equal(PUSH_NOTIFICATION_COPY.message.title, "New message");
  assert.equal(PUSH_NOTIFICATION_COPY.helpUpdate.title, "New help update");
  assert.equal(PUSH_NOTIFICATION_COPY.paymentFailed.body, "You need to update your payment method.");
  for (const copy of Object.values(PUSH_NOTIFICATION_COPY)) {
    assert.ok(copy.title.length <= 40);
    assert.ok(copy.body.length <= 100);
  }
});
