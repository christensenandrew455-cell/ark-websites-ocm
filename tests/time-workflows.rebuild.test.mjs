import assert from "node:assert/strict";
import test from "node:test";

import {
  businessNow,
  isDateDue,
  nextBusinessWeekdayDate,
  resolveEstimateSchedule,
} from "../app/lib/businessTime.js";
import {
  ACCOUNT_VERIFICATION_DEADLINE_MS,
  accountVerificationDeadline,
  accountVerificationExpired,
  newAccountVerificationDeadline,
  ownerAccountNeedsIdentityVerification,
} from "../app/lib/accountVerificationDeadline.js";
import {
  DAY_MS,
  estimateRequestLifecycle,
} from "../app/lib/estimateRequestLifecycle.js";
import {
  isPastRetention,
  retentionCutoff,
} from "../app/lib/leadRetention.js";
import {
  isConversationPastRetention,
  messageRetentionCutoff,
} from "../app/lib/messageRetention.js";
import {
  calendarMonthWindow,
  isWithinWindow,
  subscriptionPeriodWindow,
  validTimeZone,
} from "../app/lib/timeWindows.js";

test("owner identity verification expires at exactly one hour without resetting", () => {
  const activatedAt = new Date("2026-08-13T12:00:00.000Z");
  const account = {
    role: "customer",
    accountType: "owner",
    identityVerificationRequired: true,
    identityVerificationVerified: false,
    activatedAt,
  };
  assert.equal(ACCOUNT_VERIFICATION_DEADLINE_MS, 3_600_000);
  assert.equal(newAccountVerificationDeadline(activatedAt).toISOString(), "2026-08-13T13:00:00.000Z");
  assert.equal(accountVerificationDeadline(account).toISOString(), "2026-08-13T13:00:00.000Z");
  assert.equal(accountVerificationExpired(account, "2026-08-13T12:59:59.999Z"), false);
  assert.equal(accountVerificationExpired(account, "2026-08-13T13:00:00.000Z"), true);
  assert.equal(ownerAccountNeedsIdentityVerification({ ...account, accountType: "employee", role: "employee" }), false);
  assert.equal(accountVerificationExpired({ ...account, identityVerificationVerified: true }, "2026-08-13T14:00:00.000Z"), false);
});

test("estimate requests are red only during day seven and expire after seven full days", () => {
  const createdAt = Date.parse("2026-08-01T12:00:00.000Z");
  assert.deepEqual(estimateRequestLifecycle(createdAt, createdAt + 6 * DAY_MS - 1), {
    ageMs: 6 * DAY_MS - 1,
    finalDay: false,
    expired: false,
  });
  assert.equal(estimateRequestLifecycle(createdAt, createdAt + 6 * DAY_MS).finalDay, true);
  assert.equal(estimateRequestLifecycle(createdAt, createdAt + 7 * DAY_MS - 1).finalDay, true);
  assert.deepEqual(estimateRequestLifecycle(createdAt, createdAt + 7 * DAY_MS), {
    ageMs: 7 * DAY_MS,
    finalDay: false,
    expired: true,
  });
});

test("lead and message retention delete at the exact configured boundary", () => {
  const now = Date.parse("2026-08-10T15:30:00.000Z");
  const exactBoundary = now - 7 * DAY_MS;
  assert.equal(retentionCutoff(7, now), exactBoundary);
  assert.equal(messageRetentionCutoff(7, new Date(now)), exactBoundary);
  assert.equal(isPastRetention(exactBoundary + 1, 7, now), false);
  assert.equal(isPastRetention(exactBoundary, 7, now), true);
  assert.equal(isConversationPastRetention({ lastMessageAt: exactBoundary + 1 }, 7, now), false);
  assert.equal(isConversationPastRetention({ lastMessageAt: exactBoundary }, 7, now), true);
});

test("calendar billing windows use local month boundaries across DST", () => {
  const spring = calendarMonthWindow("America/New_York", new Date("2026-03-15T12:00:00.000Z"));
  assert.equal(spring.monthKey, "2026-03");
  assert.equal(new Date(spring.startMs).toISOString(), "2026-03-01T05:00:00.000Z");
  assert.equal(new Date(spring.endMs).toISOString(), "2026-04-01T04:00:00.000Z");
  assert.equal((spring.endMs - spring.startMs) / 3_600_000, 743);

  const fall = calendarMonthWindow("America/New_York", new Date("2026-11-15T12:00:00.000Z"));
  assert.equal(new Date(fall.startMs).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(new Date(fall.endMs).toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal((fall.endMs - fall.startMs) / 3_600_000, 721);
});

test("subscription window uses the common active item period and exact end exclusion", () => {
  const fallback = calendarMonthWindow("America/New_York", new Date("2026-08-10T12:00:00.000Z"));
  const window = subscriptionPeriodWindow({
    items: {
      data: [
        { current_period_start: 100, current_period_end: 500 },
        { current_period_start: 200, current_period_end: 600 },
      ],
    },
  }, fallback);
  assert.equal(window.startMs, 200_000);
  assert.equal(window.endMs, 500_000);
  assert.equal(isWithinWindow(200_000, window), true);
  assert.equal(isWithinWindow(499_999, window), true);
  assert.equal(isWithinWindow(500_000, window), false);
  assert.equal(subscriptionPeriodWindow({}, fallback), fallback);
});

test("business calendar calculations honor each account timezone", () => {
  const instant = new Date("2026-08-09T10:00:00.000Z");
  const kiritimati = businessNow(instant, "Pacific/Kiritimati");
  assert.equal(kiritimati.dateKey, "2026-08-10");
  assert.equal(kiritimati.weekday, "Monday");
  assert.equal(isDateDue("2026-08-10", instant, "Pacific/Kiritimati"), true);
  assert.equal(isDateDue("2026-08-10", instant, "America/New_York"), false);
});

test("next weekday remains correct in UTC+14 instead of drifting a calendar day", () => {
  const instant = new Date("2026-08-09T10:00:00.000Z");
  assert.deepEqual(nextBusinessWeekdayDate("Monday", instant, "Pacific/Kiritimati"), {
    year: 2026,
    month: 8,
    day: 17,
    dateKey: "2026-08-17",
  });
});

test("next-day scheduling supports configured weekend estimate days", () => {
  const friday = new Date("2026-08-14T16:00:00.000Z");
  assert.equal(nextBusinessWeekdayDate("Saturday", friday, "America/New_York").dateKey, "2026-08-15");
  assert.equal(nextBusinessWeekdayDate("Sunday", friday, "America/New_York").dateKey, "2026-08-16");
});

test("estimate schedule conversion observes the account DST offset", () => {
  const schedule = resolveEstimateSchedule(
    "Monday",
    "9:00 am",
    new Date("2026-03-07T12:00:00.000Z"),
    "America/New_York"
  );
  assert.equal(schedule.estimateDate, "2026-03-09");
  assert.equal(schedule.estimateAt.toISOString(), "2026-03-09T13:00:00.000Z");
  assert.equal(schedule.followUpAt.toISOString(), "2026-03-09T13:30:00.000Z");
});

test("invalid account timezones safely fall back to the business default", () => {
  assert.equal(validTimeZone("Not/A_Timezone"), "America/New_York");
});
