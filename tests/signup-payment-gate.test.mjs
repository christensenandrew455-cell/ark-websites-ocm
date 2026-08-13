import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  normalizeOwnerSignup,
  ownerSignupDigestInput,
  validateOwnerSignup,
} from "../app/lib/ownerSignup.js";
import { businessInformationText, normalizeBusinessInformation } from "../app/lib/receptionistBusinessInformation.js";
import { ownerFacingError, publicFormError } from "../app/lib/userFacingError.js";
import {
  accountPhoneRegistryId,
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
  assert.equal(accountPhoneRegistryId("(978) 555-1212"), "19785551212");
  assert.equal(signupAvailabilityMessage({ businessNameInUse: true, emailInUse: false, phoneInUse: false }), "That business name is already registered. Use a different business name.");
  assert.equal(signupAvailabilityMessage({ emailInUse: true, phoneInUse: false }), "That email address is already registered.");
  assert.equal(signupAvailabilityMessage({ emailInUse: false, phoneInUse: true }), "That phone number is already registered.");
  assert.equal(signupAvailabilityMessage({ emailInUse: true, phoneInUse: true }), "That email address and phone number are already registered.");
});

test("customer-facing errors never expose Firebase or deployment internals", () => {
  assert.equal(ownerFacingError(new Error("Firebase: Error (auth/network-request-failed).")), "No internet connection. Reload and try again.");
  assert.equal(ownerFacingError(new Error("Firebase permission-denied")), "Something went wrong. Reload and try again.");
  assert.equal(publicFormError(new Error("Firebase Admin credentials are invalid"), "Unable to continue."), "Unable to continue.");
  assert.equal(publicFormError(new Error("That email address is already registered.")), "That email address is already registered.");
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

test("Stripe return starts billing before immediate activation and referral qualification", async () => {
  const [finalizeSource, referralSource, billingSource] = await Promise.all([
    readFile(new URL("../app/api/signup/finalize/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/referrals.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/stripeUsageBilling.js", import.meta.url), "utf8"),
  ]);
  const subscriptionCreated = finalizeSource.indexOf("const subscription = await ensureCustomerBillingSubscription");
  const activeAccount = finalizeSource.indexOf('status: "active"', subscriptionCreated);
  const referralQualified = finalizeSource.indexOf("qualifyReferralAfterActivation", activeAccount);
  assert.ok(subscriptionCreated >= 0 && activeAccount > subscriptionCreated && referralQualified > activeAccount);
  assert.ok(finalizeSource.includes('subscription.status !== "active"'));
  assert.ok(finalizeSource.includes("subscriptionIdempotencyKey"));
  assert.ok(finalizeSource.includes('numberAssignmentStatus: "needed"'));
  assert.equal(finalizeSource.includes('status: "pending_admin_approval"'), false);
  assert.ok(billingSource.includes('payment_behavior: "error_if_incomplete"'));
  assert.ok(referralSource.includes('paymentSetupStatus !== "complete"'));
  assert.ok(referralSource.includes('subscriptionStatusForReferredAccount !== "active"'));
  assert.ok(referralSource.includes('referralStatus: "pending_payment"'));
});

test("signup keeps the account-type choices but removes the blue instructional spiel", async () => {
  const source = await readFile(new URL("../app/signup/page.js", import.meta.url), "utf8");
  assert.ok(source.includes("Choose an account type"));
  assert.ok(source.includes("Owner account"));
  assert.ok(source.includes("Employee account"));
  assert.equal(source.includes("Enter the business and account information below"), false);
  assert.equal(source.includes("Owner approval required"), false);
  assert.equal(source.includes("bg-indigo-50 p-4 text-sm"), false);
});

test("active accounts enter a same-area-code number assignment queue without approval", async () => {
  const [approvalSource, connectionsSource] = await Promise.all([
    readFile(new URL("../app/api/admin/signup-applications/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/connections/page.js", import.meta.url), "utf8"),
  ]);
  assert.ok(approvalSource.includes('document.data().status === "active"'));
  assert.ok(approvalSource.includes('document.data().numberAssignmentStatus === "needed"'));
  assert.ok(approvalSource.includes("areaCode(receptionistPhoneNormalized) !== ownerAreaCode"));
  assert.ok(approvalSource.includes("connectionPhoneRegistry"));
  assert.ok(approvalSource.includes("sendSignupText"));
  assert.ok(connectionsSource.includes("Needs a Number"));
  assert.ok(connectionsSource.includes("Assign Number"));
  assert.equal(connectionsSource.includes("Accept Person"), false);
  assert.equal(connectionsSource.includes("Decline and Delete"), false);
});

test("pending signup details survive Stripe only as encrypted temporary Firebase data", async () => {
  const [pendingSource, checkoutSource, completeSource] = await Promise.all([
    readFile(new URL("../app/lib/pendingOwnerSignup.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/create-checkout-session/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/signup/complete/page.js", import.meta.url), "utf8"),
  ]);
  assert.ok(pendingSource.includes('createCipheriv("aes-256-gcm"'));
  assert.ok(pendingSource.includes('const COLLECTION = "pendingOwnerSignups"'));
  assert.ok(pendingSource.includes("OWNER_SIGNUP_DRAFT_MAX_AGE_MS"));
  assert.ok(pendingSource.includes("handoffHash"));
  assert.ok(checkoutSource.includes("savePendingOwnerSignup"));
  assert.ok(checkoutSource.includes("randomBytes(32)"));
  assert.ok(checkoutSource.includes("/signup/return?session_id={CHECKOUT_SESSION_ID}&handoff="));
  assert.ok(completeSource.includes("JSON.stringify({ sessionId, handoff"));
  assert.equal(completeSource.includes("unfinished signup was discarded"), false);
});

test("launch owners verify separate email and text codes sent from the central ARK number", async () => {
  const [launchSource, envSource, verificationSource, gateSource, checkoutSource, requestSource, rulesSource] = await Promise.all([
    readFile(new URL("../app/lib/launchFeatures.js", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/accountVerification.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AccountVerificationGate.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/create-checkout-session/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/authenticatedRequest.js", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  ]);
  assert.ok(launchSource.includes('phoneVerification: "on"'));
  assert.ok(envSource.includes("TELNYX_SIGNUP_FROM_NUMBER=+17742316164"));
  assert.ok(verificationSource.includes("randomInt(0, 10_000)"));
  assert.ok(verificationSource.includes("https://api.resend.com/emails"));
  assert.ok(verificationSource.includes("TELNYX_SIGNUP_FROM_NUMBER"));
  assert.ok(verificationSource.includes("...(PHONE_VERIFICATION_REQUIRED ? ["));
  assert.ok(verificationSource.includes('codeHash(uid, "email"'));
  assert.ok(verificationSource.includes('codeHash(uid, "phone"'));
  assert.ok(verificationSource.includes("!PHONE_VERIFICATION_REQUIRED || challenge.phoneVerified"));
  assert.ok(checkoutSource.includes("missingAccountVerificationConfiguration()"));
  assert.ok(gateSource.includes('status?.phoneRequired ? "Verify your email and phone" : "Verify your email"'));
  assert.ok(gateSource.includes("Email code"));
  assert.ok(gateSource.includes("Text code"));
  assert.ok(gateSource.includes("status?.phoneRequired && <label"));
  assert.ok(gateSource.includes("Use Resend Code below."));
  assert.ok(requestSource.includes("ACCOUNT_VERIFICATION_REQUIRED"));
  assert.ok(rulesSource.includes("identityVerificationVerified"));
});

test("verified owners receive a blocking but skippable highlighted guided tour", async () => {
  const [tourSource, shellSource, statsSource, settingsSource, referralSource] = await Promise.all([
    readFile(new URL("../app/components/GuidedOnboarding.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ClientStats.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SettingsPanel.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReferralCenter.js", import.meta.url), "utf8"),
  ]);
  assert.ok(tourSource.includes("Skip Tour"));
  assert.ok(tourSource.includes("yellow-300"));
  assert.ok(tourSource.includes("backdrop-grayscale"));
  assert.ok(tourSource.includes("/api/account/onboarding-tour"));
  assert.ok(shellSource.includes("<GuidedOnboarding />"));
  assert.ok(statsSource.includes('tourId="dashboard-leads"'));
  assert.ok(settingsSource.includes('tourId="settings-section-back"'));
  assert.ok(referralSource.includes('data-tour-id="referral-star"'));
});

test("native Stripe return links are registered and verification data joins account deletion", async () => {
  const [returnSource, handlerSource, androidSource, iosSource, packageSource, lifecycleSource] = await Promise.all([
    readFile(new URL("../app/signup/return/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppUrlHandler.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/configure-android.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/configure-ios.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/customerLifecycle.js", import.meta.url), "utf8"),
  ]);
  assert.ok(returnSource.includes("arkclientcenter://open"));
  assert.ok(returnSource.includes("window.location.replace"));
  assert.ok(handlerSource.includes('App.addListener("appUrlOpen"'));
  assert.ok(androidSource.includes('android:scheme="arkclientcenter"'));
  assert.ok(iosSource.includes('addPlistUrlScheme(plist, "arkclientcenter")'));
  assert.ok(packageSource.includes('"@capacitor/app"'));
  assert.ok(lifecycleSource.includes('collection("accountVerificationChallenges")'));
  assert.ok(lifecycleSource.includes('collection("pendingOwnerSignups")'));
});

test("owner deletion uses the shared full-account cascade and stores no deletion audit", async () => {
  const [ownerDeleteSource, lifecycleSource] = await Promise.all([
    readFile(new URL("../app/api/account/delete/route.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/customerLifecycle.js", import.meta.url), "utf8"),
  ]);
  assert.ok(ownerDeleteSource.includes("deleteCustomerPermanently"));
  assert.ok(lifecycleSource.includes("stripe.customers.del"));
  assert.ok(lifecycleSource.includes("accountPhoneRegistry"));
  assert.ok(lifecycleSource.includes("connectionPhoneRegistry"));
  assert.ok(lifecycleSource.includes("messagingComplianceEvents"));
  assert.ok(lifecycleSource.includes("db.recursiveDelete(businessRef)"));
  assert.equal(ownerDeleteSource.includes("deletedAccountAudit"), false);
});
