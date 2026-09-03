import assert from "node:assert/strict";
import test from "node:test";
import {
  compareOldestLead,
  formatLeadReceivedAt,
  regularLeadAgeBand,
} from "../app/lib/leadQueuePresentation.js";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

test("regular lead borders change at the exact 24-hour and 48-hour boundaries", () => {
  assert.equal(regularLeadAgeBand(NOW - 23 * 60 * 60 * 1000, NOW), "new");
  assert.equal(regularLeadAgeBand(NOW - 24 * 60 * 60 * 1000, NOW), "waiting");
  assert.equal(regularLeadAgeBand(NOW - 47 * 60 * 60 * 1000, NOW), "waiting");
  assert.equal(regularLeadAgeBand(NOW - 48 * 60 * 60 * 1000, NOW), "overdue");
});

test("received timestamps progress from Now to minutes, hours, and a calendar day", () => {
  assert.equal(formatLeadReceivedAt(NOW - 59_000, NOW), "Now");
  assert.equal(formatLeadReceivedAt(NOW - 60_000, NOW), "1 minute");
  assert.equal(formatLeadReceivedAt(NOW - 2 * 60_000, NOW), "2 minutes");
  assert.equal(formatLeadReceivedAt(NOW - 60 * 60_000, NOW), "1 hour");
  assert.equal(formatLeadReceivedAt(NOW - 23 * 60 * 60_000, NOW), "23 hours");
  assert.equal(formatLeadReceivedAt("2026-09-01T12:00:00.000Z", NOW), "September 1st");
  assert.equal(formatLeadReceivedAt("2025-09-03T12:00:00.000Z", NOW), "September 3rd, 2025");
});

test("lead queues put the oldest received request first and unknown timestamps last", () => {
  const rows = [
    { id: "new", createdAt: "2026-09-03T11:00:00.000Z" },
    { id: "unknown" },
    { id: "old", createdAt: "2026-09-01T11:00:00.000Z" },
  ];
  assert.deepEqual(rows.sort(compareOldestLead).map((row) => row.id), ["old", "new", "unknown"]);
});
