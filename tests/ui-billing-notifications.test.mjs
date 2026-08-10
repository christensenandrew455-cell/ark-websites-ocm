import assert from "node:assert/strict";
import test from "node:test";
import { PUSH_NOTIFICATION_COPY } from "../app/lib/notificationCopy.js";

test("phone notifications use only short generic labels", () => {
  assert.deepEqual(PUSH_NOTIFICATION_COPY.lead, { title: "New lead" });
  assert.deepEqual(PUSH_NOTIFICATION_COPY.message, { title: "New message" });
  assert.deepEqual(PUSH_NOTIFICATION_COPY.helpUpdate, { title: "New help update" });
  for (const copy of Object.values(PUSH_NOTIFICATION_COPY)) {
    assert.equal(Object.hasOwn(copy, "body"), false);
  }
});
