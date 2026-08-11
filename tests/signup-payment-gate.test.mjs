import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  normalizeOwnerSignup,
  ownerSignupDigestInput,
  validateOwnerSignup,
} from "../app/lib/ownerSignup.js";
import { businessInformationText, normalizeBusinessInformation } from "../app/lib/receptionistBusinessInformation.js";
import {
  normalizeSignupPhone,
  signupAvailabilityMessage,
  signupPhoneVariants,
} from "../app/lib/signupAvailability.js";

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
      estimateWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      estimateStartHour: 9,
      estimateStartPeriod: "AM",
      estimateEndHour: 4,
      estimateEndPeriod: "PM",
      serviceAreas: ["Worcester, Massachusetts"],
      services: { "interior painting": "interior painting" },
      businessInformation: [{ title: "Business hours", info: "Every day, 5 PM to 9 PM" }],
    },
  };
}

test("owner signup keeps step-one business identity authoritative", () => {
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

test("business hours are not required and estimate availability is optional", () => {
  const signup = completeSignup();
  signup.receptionist.estimateWeekdays = [];
  signup.receptionist.estimateStartHour = "";
  signup.receptionist.estimateStartPeriod = "";
  signup.receptionist.estimateEndHour = "";
  signup.receptionist.estimateEndPeriod = "";
  assert.equal(validateOwnerSignup(signup), "");

  signup.receptionist.estimateStartHour = 9;
  signup.receptionist.estimateStartPeriod = "AM";
  assert.equal(validateOwnerSignup(signup), "Choose at least one estimate day or leave the estimate schedule blank.");
});

test("custom business information keeps complete title and info pairs", () => {
  const information = normalizeBusinessInformation([
    { title: " Business hours ", info: " Every day, 5 PM to 9 PM " },
    { title: "Business hours", info: "Every day, 5 PM to 9 PM" },
    { title: "Missing info", info: "" },
  ]);
  assert.deepEqual(information, [{ title: "Business hours", info: "Every day, 5 PM to 9 PM" }]);
  assert.equal(businessInformationText(information), "Business hours: Every day, 5 PM to 9 PM");
  assert.deepEqual(normalizeOwnerSignup(completeSignup()).receptionist.businessInformation, information);
});

test("a new owner signup does not assume any business-information selection", () => {
  const signup = completeSignup();
  signup.receptionist = {
    serviceAreas: [],
    services: {},
    timeZone: "Choose",
    businessWeekdays: [],
    estimateWeekdays: [],
  };
  const normalized = normalizeOwnerSignup(signup);
  assert.equal(normalized.receptionist.timeZone, "");
  assert.deepEqual(normalized.receptionist.businessWeekdays, []);
  assert.deepEqual(normalized.receptionist.estimateWeekdays, []);
  assert.equal(normalized.receptionist.businessStartHour, "");
  assert.equal(normalized.receptionist.businessStartPeriod, "");
  assert.equal(normalized.receptionist.businessEndHour, "");
  assert.equal(normalized.receptionist.businessEndPeriod, "");
  assert.equal(normalized.receptionist.estimateStartHour, "");
  assert.equal(normalized.receptionist.estimateStartPeriod, "");
  assert.equal(normalized.receptionist.estimateEndHour, "");
  assert.equal(normalized.receptionist.estimateEndPeriod, "");
  assert.equal(normalized.receptionist.businessHours, "");
  assert.equal(validateOwnerSignup(normalized), "Choose a time zone.");
});

test("the payment-session digest binds the password and every signup field", () => {
  const first = completeSignup();
  const second = { ...completeSignup(), password: "a different secure password" };
  assert.notEqual(ownerSignupDigestInput(first), ownerSignupDigestInput(second));
  assert.equal(ownerSignupDigestInput(first), ownerSignupDigestInput(completeSignup()));
  assert.equal(ownerSignupDigestInput({ ...first, businessInformationCompleted: true }), ownerSignupDigestInput(first));
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

test("signup detects equivalent phone formats and reports duplicate contacts clearly", () => {
  assert.equal(normalizeSignupPhone("(978) 555-1212"), "+19785551212");
  const variants = signupPhoneVariants("+1 978 555 1212");
  assert.ok(variants.includes("(978) 555-1212"));
  assert.ok(variants.includes("978-555-1212"));
  assert.equal(signupAvailabilityMessage({ emailInUse: true, phoneInUse: false }), "That email address is already registered.");
  assert.equal(signupAvailabilityMessage({ emailInUse: false, phoneInUse: true }), "That phone number is already registered.");
  assert.equal(signupAvailabilityMessage({ emailInUse: true, phoneInUse: true }), "That email address and phone number are already registered.");
});

test("the signed-out draft can reach business information without being forced to login", async () => {
  const shellSource = await readFile(new URL("../app/components/SignupFlowShell.js", import.meta.url), "utf8");
  assert.ok(shellSource.includes("setupPage && user && (isAdmin || isEmployee)"));
  assert.equal(shellSource.includes("router.replace(user ? \"/\" : \"/login\")"), false);
});

test("all pre-payment signup steps expose navigation above the mobile safe area", async () => {
  const [accountSource, businessSource, aboutSource] = await Promise.all([
    readFile(new URL("../app/signup/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/setup/business/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SignupAboutContinue.js", import.meta.url), "utf8"),
  ]);
  assert.ok(accountSource.includes(">Back</Link>"));
  assert.ok(businessSource.includes(">Back</Link>"));
  assert.ok(businessSource.includes(">Next</button>"));
  assert.ok(aboutSource.includes("/setup/business?signup=1"));
  assert.ok(aboutSource.includes("safe-area-inset-bottom"));
});

test("owner signup checks email and phone before advancing and checks again after payment", async () => {
  const [accountSource, checkoutSource, finalizeSource] = await Promise.all([
    readFile(new URL("../app/signup/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/create-checkout-session/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/signup/finalize/route.js", import.meta.url), "utf8"),
  ]);
  const availabilityCheck = accountSource.indexOf("/api/signup/availability");
  const businessStep = accountSource.indexOf("router.push(\"/setup/business?signup=1\")");
  assert.ok(availabilityCheck >= 0 && availabilityCheck < businessStep);
  assert.ok(checkoutSource.includes("checkSignupAvailability"));
  const finalPhoneCheck = finalizeSource.indexOf("availability.phoneInUse");
  const accountCreated = finalizeSource.indexOf("auth.createUser(");
  assert.ok(finalPhoneCheck >= 0 && finalPhoneCheck < accountCreated);
});

test("business information UI stays compact in onboarding and settings", async () => {
  const [businessPageSource, formSource] = await Promise.all([
    readFile(new URL("../app/setup/business/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReceptionistBusinessForm.js", import.meta.url), "utf8"),
  ]);
  assert.ok(businessPageSource.includes("onboardingMode"));
  assert.equal(businessPageSource.includes("identityReadOnly"), false);
  assert.equal(businessPageSource.includes("filled from step 1"), false);
  assert.ok(formSource.includes('<option value="">Choose</option>'));
  assert.ok(formSource.includes("onClick={addItem}"));
  assert.ok(formSource.includes("aria-label={`Remove ${item}`}"));
  assert.ok(formSource.includes("<div className=\"flex h-11 min-w-0 flex-1 items-center"));
  assert.equal(formSource.includes('label="Business days"'), false);
  assert.equal(formSource.includes('label="Business opens"'), false);
  assert.equal(formSource.includes('label="Business closes"'), false);
  assert.ok(formSource.includes('label="Estimate days"'));
  assert.equal(formSource.includes("Estimate days (optional)"), false);
  assert.ok(formSource.includes("Information title"));
  assert.ok(formSource.includes("Information details"));
  assert.ok(formSource.includes(">Add Info</button>"));
  assert.ok(formSource.includes("aria-expanded={open}"));
  assert.ok(formSource.includes("Show\"} explanation for ${label}"));
  assert.ok(formSource.includes("Add each town, city, county, or state where the business accepts jobs."));
  assert.ok(formSource.includes("{identitySection}"));
  assert.ok(formSource.includes("{sharedSections}"));
  assert.equal(formSource.includes("These locations help the AI receptionist"), false);
  assert.equal(formSource.includes("Choose the business time zone. Estimate days and hours"), false);
});

test("saved business information reaches settings and receptionist runtime without business-hour defaults", async () => {
  const [settingsSource, runtimeSource, finalizeSource] = await Promise.all([
    readFile(new URL("../app/api/receptionist/settings/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/receptionist/runtime/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/signup/finalize/route.js", import.meta.url), "utf8"),
  ]);
  assert.ok(settingsSource.includes("businessInformation: profile.businessInformation"));
  assert.ok(settingsSource.includes("businessHours: FieldValue.delete()"));
  assert.ok(runtimeSource.includes("estimateSchedulingConfigured"));
  assert.ok(runtimeSource.includes("businessInformation,"));
  assert.ok(runtimeSource.includes("extraInformation: businessInformationText(businessInformation)"));
  assert.equal(runtimeSource.includes("businessHours:"), false);
  assert.ok(finalizeSource.includes("businessInformation: signup.receptionist.businessInformation || []"));
  assert.equal(finalizeSource.includes("businessHours: signup.receptionist.businessHours"), false);
});

test("the payment step is limited to secure payment setup controls", async () => {
  const source = await readFile(new URL("../app/signup/status/page.js", import.meta.url), "utf8");
  assert.ok(source.includes("Add Payment Method"));
  assert.equal(source.includes("Account not created yet"), false);
  assert.equal(source.includes("What this payment method covers"), false);
  assert.equal(source.includes("BILLING_SUMMARY"), false);
  assert.equal(source.includes("Qualified referrals save"), false);
});

test("payment setup creates and reuses an explicit Stripe customer", async () => {
  const source = await readFile(new URL("../app/api/billing/create-checkout-session/route.js", import.meta.url), "utf8");
  const customerCreated = source.indexOf("stripe.customers.create");
  const sessionCreated = source.indexOf("stripe.checkout.sessions.create");
  assert.ok(customerCreated >= 0 && customerCreated < sessionCreated);
  assert.ok(source.includes("customer: customer.id"));
  assert.ok(source.includes("ark-owner-signup-customer-${digest}"));
  assert.equal(source.includes('customer_creation: "always"'), false);
});

test("employees skip owner-only onboarding, payment, and referrals", async () => {
  const [signupSource, employeeRouteSource, shellSource] = await Promise.all([
    readFile(new URL("../app/signup/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/signup/employee/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SignupFlowShell.js", import.meta.url), "utf8"),
  ]);
  assert.ok(signupSource.includes("!employeeSignup && <label"));
  assert.ok(signupSource.includes('router.replace("/employee/pending")'));
  assert.equal(employeeRouteSource.includes("referrerAccountId"), false);
  assert.ok(shellSource.includes("setupPage && user && (isAdmin || isEmployee)"));
});

test("a referral qualifies only after an active paid subscription exists", async () => {
  const [finalizeSource, referralSource, billingSource] = await Promise.all([
    readFile(new URL("../app/api/signup/finalize/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/referrals.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/stripeUsageBilling.js", import.meta.url), "utf8"),
  ]);
  const subscriptionCreated = finalizeSource.indexOf("const subscription = await ensureCustomerBillingSubscription");
  const referralQualified = finalizeSource.indexOf("qualifyReferralAfterActivation", subscriptionCreated);
  assert.ok(subscriptionCreated >= 0 && referralQualified > subscriptionCreated);
  assert.ok(billingSource.includes('payment_behavior: "error_if_incomplete"'));
  assert.ok(referralSource.includes('paymentSetupStatus !== "complete"'));
  assert.ok(referralSource.includes('subscriptionStatusForReferredAccount !== "active"'));
  assert.ok(referralSource.includes('referralStatus: "pending_payment"'));
});
