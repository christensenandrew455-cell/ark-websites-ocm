import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  ASAP_OR_SCHEDULED_QUESTION,
  ASAP_REQUEST_TIME,
  activeEmergencyServiceSettings,
  emergencyServiceAvailabilityError,
  isEmergencyRequest,
  normalizeEmergencyServiceSettings,
  normalizeRequestUrgency,
  regularServiceScheduleConfigured,
  receptionistRequestRouting,
} from "../app/lib/emergencyService.js";
import { normalizeOwnerSignup, validateReceptionistBusinessInformation } from "../app/lib/ownerSignup.js";

function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("emergency service is off by default and cannot retain a hidden 24-hour setting", () => {
  assert.deepEqual(normalizeEmergencyServiceSettings({}), {
    emergencyServiceEnabled: false,
    emergencyService24Hours: false,
  });
  assert.deepEqual(normalizeEmergencyServiceSettings({ emergencyServiceEnabled: false, emergencyService24Hours: true }), {
    emergencyServiceEnabled: false,
    emergencyService24Hours: false,
  });
});

test("scheduled-only routing never includes an emergency prompt or branch", () => {
  const routing = receptionistRequestRouting({ emergencyServiceEnabled: false });
  assert.equal(routing.mode, "scheduled-only");
  assert.equal(routing.timingQuestion, "");
  assert.equal(routing.scheduled.enabled, true);
  assert.equal(Object.hasOwn(routing, "emergency"), false);
});

test("enabled emergency routing offers ASAP or normal scheduling without promising dispatch", () => {
  const routing = receptionistRequestRouting({ emergencyServiceEnabled: true, emergencyService24Hours: true });
  assert.equal(routing.mode, "asap-or-scheduled");
  assert.equal(routing.timingQuestion, ASAP_OR_SCHEDULED_QUESTION);
  assert.equal(routing.emergency.availability, "24/7");
  assert.equal(routing.emergency.intakeValue, "emergency");
  assert.equal(routing.emergency.requestedTimeWindow, ASAP_REQUEST_TIME);
  assert.match(routing.emergency.instruction, /do not promise/i);

  const regularHours = receptionistRequestRouting({
    emergencyServiceEnabled: true,
    emergencyService24Hours: false,
    estimateWeekdays: ["monday"],
    earliestEstimateStart: "9:00 AM",
    latestEstimateStart: "5:00 PM",
  });
  assert.equal(regularHours.emergency.availability, "regular-service-hours");
  assert.equal(regularHours.scheduled.enabled, true);
});

test("non-24-hour emergency service requires a complete regular service window", () => {
  const incomplete = { emergencyServiceEnabled: true, emergencyService24Hours: false };
  assert.equal(regularServiceScheduleConfigured(incomplete), false);
  assert.equal(emergencyServiceAvailabilityError(incomplete), "Add regular service days and times, or turn on 24/7 emergency availability.");
  const scheduled = {
    ...incomplete,
    estimateWeekdays: ["monday", "tuesday"],
    earliestEstimateStart: "9:00 AM",
    latestEstimateStart: "5:00 PM",
  };
  assert.equal(regularServiceScheduleConfigured(scheduled), true);
  assert.equal(emergencyServiceAvailabilityError(scheduled), "");
  assert.equal(emergencyServiceAvailabilityError({ ...incomplete, emergencyService24Hours: true }), "");
  assert.deepEqual(activeEmergencyServiceSettings(incomplete), {
    emergencyServiceEnabled: false,
    emergencyService24Hours: false,
  });
  assert.deepEqual(activeEmergencyServiceSettings(scheduled), {
    emergencyServiceEnabled: true,
    emergencyService24Hours: false,
  });
  assert.equal(validateReceptionistBusinessInformation({
    ...incomplete,
    timeZone: "America/New_York",
    businessType: "Plumbing",
    serviceAreas: ["Massachusetts"],
    services: { plumbing: "plumbing" },
  }), "Add regular service days and times, or turn on 24/7 emergency availability.");
});

test("only explicit urgency values classify a lead as emergency", () => {
  for (const value of ["emergency", "urgent", "asap", "As soon as possible", true]) {
    assert.equal(normalizeRequestUrgency(value), "emergency");
  }
  assert.equal(normalizeRequestUrgency("scheduled"), "");
  assert.equal(normalizeRequestUrgency({ Notes: "My pipe burst and this is an emergency" }), "");
  assert.equal(isEmergencyRequest({ RequestUrgency: "emergency" }), true);
  assert.equal(isEmergencyRequest({ requestUrgency: "normal" }), false);
});

test("signup normalization keeps emergency choices in the business profile", () => {
  const signup = normalizeOwnerSignup({
    receptionist: {
      emergencyServiceEnabled: true,
      emergencyService24Hours: true,
    },
  }, { includePassword: false });
  assert.equal(signup.receptionist.emergencyServiceEnabled, true);
  assert.equal(signup.receptionist.emergencyService24Hours, true);
});

test("runtime, intake, lead cards, and notifications share the explicit emergency marker", async () => {
  const [runtime, intake, leadCards, notifications] = await Promise.all([
    source("app/api/receptionist/runtime/route.js"),
    source("app/api/intake/route.js"),
    source("app/components/ReviewClientsNative.js"),
    source("app/lib/notificationService.js"),
  ]);
  assert.ok(runtime.includes("serviceRequestRouting: receptionistRequestRouting(account)"));
  assert.ok(runtime.includes("...(emergencyService.emergencyServiceEnabled ? emergencyService : {})"));
  assert.ok(intake.includes("buildRow(data, source, emergencyService.emergencyServiceEnabled)"));
  assert.ok(intake.includes("...(RequestUrgency ? { RequestUrgency } : {})"));
  assert.ok(leadCards.includes("function EmergencyBadge"));
  assert.ok(leadCards.includes("Emergency · ASAP"));
  assert.ok(leadCards.includes('title="Emergencies"'));
  assert.ok(leadCards.includes('title="Regular"'));
  assert.ok(leadCards.includes("sort(compareOldestLead)"));
  assert.ok(notifications.includes("PUSH_NOTIFICATION_COPY.emergencyLead"));
});
