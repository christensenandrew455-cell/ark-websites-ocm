import assert from "node:assert/strict";
import test from "node:test";
import { mergeablePropertyMatches } from "../app/lib/intakeLeadRecords.js";

test("Contacted You keeps every distinct intake as its own visible record", () => {
  const existing = [
    { id: "first-call", stageKey: "contactedMe" },
    { id: "second-call", stageKey: "contactedMe" },
  ];

  assert.deepEqual(mergeablePropertyMatches("contactedMe", existing), []);
  assert.equal(mergeablePropertyMatches("clients", existing), existing);
});
