import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const intakeRoute = await readFile(new URL("../app/api/intake/route.js", import.meta.url), "utf8");

test("Contacted You creates a record for every distinct intake", () => {
  assert.ok(intakeRoute.includes("const stableIntakeId = suppliedIntakeSourceId ? intakeRecordId(clientId, suppliedIntakeSourceId) : \"\";"));
  assert.ok(intakeRoute.includes("const targetRef = stableIntakeId ? targetCollection.doc(stableIntakeId) : targetCollection.doc();"));
  assert.ok(intakeRoute.includes("batch.create(targetRef"));
  assert.ok(intakeRoute.includes("duplicate: false"));
});

test("only a repeated idempotency key is treated as the same intake", () => {
  assert.ok(intakeRoute.includes('request.headers.get("idempotency-key")'));
  assert.ok(intakeRoute.includes("data.callControlId"));
  assert.ok(intakeRoute.includes("if (stableIntakeId)"));
  assert.ok(intakeRoute.includes("duplicate: true"));
});
