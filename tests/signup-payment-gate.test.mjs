import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  normalizeOwnerSignup,
  ownerSignupDigestInput,
  validateOwnerSignup,
} from "../app/lib/ownerSignup.js";

function completeSignup() {
  return {
    businessName: "sample-painting",
    ownerName: "Taylor Owner",
    accountEmail: "taylor@example.com",
    accountPhone: "(978) 555-1212",
    password: "correct horse battery staple",
    acceptedTerms: true,
    acceptedPrivacy: true,
    termsVersion: "2026-08-10.3",
    privacyVersion: "2026-08-10.2",
    receptionist: {
      businessName: "wrong-name",
      ownerName: "Wrong Owner",
      businessPhone: "0000000000",
      businessEmail: "wrong@example.com",
      timeZone: "America/New_York",
      businessWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      businessStartHour: 9,
      businessStartPeriod: "AM",
      businessEndHour: 5,
      businessEndPeriod: "PM",
      estimateWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      estimateStartHour: 9,
      estimateStartPeriod: "AM",
      estimateEndHour: 4,
      estimateEndPeriod: "PM",
      serviceAreas: ["Worcester, Massachusetts"],
      services: { "interior painting": "interior painting" },
    },
  };
}

test("owner signup pre-fills and locks business identity from step one", () => {
  const signup = normalizeOwnerSignup(completeSignup());
  assert.equal(signup.receptionist.businessName, "sample-painting");
  assert.equal(signup.receptionist.ownerName, "Taylor Owner");
  assert.equal(signup.receptionist.businessPhone, "(978) 555-1212");
  assert.equal(signup.receptionist.businessEmail, "taylor@example.com");
  assert.equal(validateOwnerSignup(signup), "");
});

test("business information is required before the payment step", () => {
  const missingArea = completeSignup();
  missingArea.receptionist.serviceAreas = [];
  assert.equal(validateOwnerSignup(missingArea), "Add at least one service area.");

  const missingService = completeSignup();
  missingService.receptionist.services = {};
  assert.equal(validateOwnerSignup(missingService), "Add at least one service.");
});

test("the payment-session digest binds the password and every signup field", () => {
  const first = completeSignup();
  const second = { ...completeSignup(), password: "a different secure password" };
  assert.notEqual(ownerSignupDigestInput(first), ownerSignupDigestInput(second));
  assert.equal(ownerSignupDigestInput(first), ownerSignupDigestInput(completeSignup()));
});

test("the owner Auth record is created only in the post-Stripe finalize endpoint", async () => {
  const applySource = await readFile(new URL("../app/api/signup/apply/route.js", import.meta.url), "utf8");
  const finalizeSource = await readFile(new URL("../app/api/signup/finalize/route.js", import.meta.url), "utf8");
  assert.equal(applySource.includes("createUser("), false);
  const paymentConfirmed = finalizeSource.indexOf("setupIntentStatus !== \"succeeded\"");
  const accountCreated = finalizeSource.indexOf("auth.createUser(");
  assert.ok(paymentConfirmed >= 0);
  assert.ok(accountCreated >= 0);
  assert.ok(paymentConfirmed < accountCreated);
});
