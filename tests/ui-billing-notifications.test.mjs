import assert from "node:assert/strict";
import test from "node:test";
import { PUSH_NOTIFICATION_COPY } from "../app/lib/notificationCopy.js";
import { NOTIFICATION_PREVIEW_CATALOG } from "../app/lib/notificationPreviewCatalog.js";

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

test("admin preview catalog exposes every major customer notification and error family", () => {
  const ids = NOTIFICATION_PREVIEW_CATALOG.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 60);
  for (const required of [
    "new-lead",
    "new-message",
    "payment-failed",
    "payment-banner",
    "verification-code-incorrect",
    "temporary-signup-expired",
    "message-delivery-failed",
    "no-internet",
    "generic-error",
  ]) assert.ok(ids.includes(required), `${required} must be previewable`);
  for (const item of NOTIFICATION_PREVIEW_CATALOG) {
    assert.ok(item.title);
    assert.ok(item.message);
    assert.ok(item.actionLabel);
  }
});
