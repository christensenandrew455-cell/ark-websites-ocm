import assert from "node:assert/strict";
import test from "node:test";

import {
  changeReceptionistBusinessType,
  setEmergencyService24Hours,
  setRegularService24Hours,
  setRegularServiceEveryDay,
} from "../app/lib/receptionistBusinessSettings.js";
import { REGULAR_SERVICE_WEEKDAYS } from "../app/lib/emergencyService.js";

test("switching business type clears services selected for the previous type", () => {
  const profile = {
    businessType: "Plumbing",
    services: { "leak repair": "Leak repair", "pipe repair": "Pipe repair" },
    timeZone: "America/New_York",
  };

  assert.deepEqual(changeReceptionistBusinessType(profile, "HVAC"), {
    businessType: "HVAC",
    services: {},
    timeZone: "America/New_York",
  });
  assert.deepEqual(changeReceptionistBusinessType(profile, "Plumbing").services, profile.services);
});

test("turning off every-day service clears every selected day", () => {
  const profile = { regularServiceEveryDay: true, estimateWeekdays: [...REGULAR_SERVICE_WEEKDAYS] };
  assert.deepEqual(setRegularServiceEveryDay(profile, false), {
    regularServiceEveryDay: false,
    estimateWeekdays: [],
  });
  assert.deepEqual(setRegularServiceEveryDay(profile, true).estimateWeekdays, REGULAR_SERVICE_WEEKDAYS);
});

test("turning off 24-hour service starts every time field blank", () => {
  const profile = {
    regularService24Hours: true,
    estimateStartHour: 8,
    estimateStartPeriod: "AM",
    estimateEndHour: 5,
    estimateEndPeriod: "PM",
  };
  assert.deepEqual(setRegularService24Hours(profile, false), {
    regularService24Hours: false,
    estimateStartHour: "",
    estimateStartPeriod: "",
    estimateEndHour: "",
    estimateEndPeriod: "",
  });
});

test("the emergency-service switch controls one explicit 24/7 setting", () => {
  assert.deepEqual(setEmergencyService24Hours({}, true), {
    emergencyServiceEnabled: true,
    emergencyService24Hours: true,
  });
  assert.deepEqual(setEmergencyService24Hours({ emergencyServiceEnabled: true, emergencyService24Hours: true }, false), {
    emergencyServiceEnabled: false,
    emergencyService24Hours: false,
  });
});
