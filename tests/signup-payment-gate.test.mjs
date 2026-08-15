import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("onboarding pages expose the required four-step order", async () => {
  const [signup, verification, business, payment, shell] = await Promise.all([
    source("app/signup/page.js"),
    source("app/components/AccountVerificationGate.js"),
    source("app/setup/business/page.js"),
    source("app/signup/payment/PaymentSetupClient.js"),
    source("app/components/SignupFlowShell.js"),
  ]);

  assert.ok(signup.includes("Step 1 of 4 · Main information"));
  assert.ok(signup.includes('router.replace(data.nextPath || "/signup/verify")'));
  assert.ok(verification.includes("Step 2 of 4 · Verify"));
  assert.ok(verification.includes('router.replace(next.nextPath || "/setup/business")'));
  assert.ok(business.includes("Step 3 of 4 · Business information"));
  assert.ok(business.includes('router.push(data.nextPath || "/signup/payment")'));
  assert.ok(payment.includes("Step 4 of 4 · Payment"));
  assert.ok(shell.includes('if (status === "pending_verification") return "/signup/verify"'));
  assert.ok(shell.includes('if (status === "pending_business_setup") return "/setup/business"'));
  assert.ok(shell.includes('if (status === "pending_payment") return "/signup/payment"'));
});

test("main information creates a restricted account before verification", async () => {
  const [page, route] = await Promise.all([
    source("app/signup/page.js"),
    source("app/api/signup/apply/route.js"),
  ]);

  assert.ok(page.includes('fetch("/api/signup/apply"'));
  assert.ok(page.includes("signInWithCustomToken(auth, data.token)"));
  assert.equal(page.includes("sessionStorage"), false);

  const userCreated = route.indexOf("auth.createUser({");
  const accountStored = route.indexOf("transaction.create(accountRef, common)");
  const codesSent = route.indexOf("sendAccountVerificationCodes({");
  const tokenCreated = route.indexOf("auth.createCustomToken(uid, claims)");
  assert.ok(userCreated >= 0 && accountStored > userCreated && codesSent > accountStored && tokenCreated > codesSent);
  assert.ok(route.includes('status: "pending_verification"'));
  assert.ok(route.includes("identityVerificationRequired: true"));
  assert.ok(route.includes("businessSetupComplete: false"));
  assert.ok(route.includes('paymentSetupStatus: "not_started"'));
  assert.equal(route.includes("new Stripe("), false);
});

test("email and phone verification must finish before business setup", async () => {
  const [verification, route, businessRoute] = await Promise.all([
    source("app/lib/accountVerification.js"),
    source("app/api/account/verification/route.js"),
    source("app/api/receptionist/settings/route.js"),
  ]);

  assert.ok(verification.includes('codeHash(uid, "email"'));
  assert.ok(verification.includes('codeHash(uid, "phone"'));
  assert.ok(verification.includes('verification.accountStatus === "pending_verification"'));
  assert.ok(verification.includes('"pending_business_setup"'));
  assert.ok(route.includes("updateAccountVerificationContact"));
  assert.ok(route.includes("verifyAccountCodes"));
  assert.ok(businessRoute.includes('["pending_business_setup", "pending_payment"]'));
  assert.ok(businessRoute.includes('const onboardingStatus = onboarding ? { status: "pending_payment", paymentSetupStatus: "ready" } : {}'));
  assert.ok(businessRoute.includes('nextPath: "/signup/payment"'));
});

test("payment page uses Stripe Payment Element inside the app", async () => {
  const [page, client] = await Promise.all([
    source("app/signup/payment/page.js"),
    source("app/signup/payment/PaymentSetupClient.js"),
  ]);

  assert.ok(page.includes('title: "set up payment"'));
  assert.ok(client.includes("@stripe/react-stripe-js"));
  assert.ok(client.includes("@stripe/stripe-js"));
  assert.ok(client.includes("<PaymentElement"));
  assert.ok(client.includes("stripe.confirmSetup({"));
  assert.ok(client.includes('redirect: "if_required"'));
  assert.ok(client.includes("Pay & Continue"));
  assert.ok(client.includes("account set up complete"));
  assert.ok(client.includes("your payment has failed update your payment method or try again later"));
  assert.equal(client.includes('name="cardNumber"'), false);
  assert.equal(client.includes('name="cvc"'), false);
  assert.equal(client.includes("stripe.checkout"), false);
});

test("SetupIntent route derives the Stripe Customer from the authenticated account", async () => {
  const route = await source("app/api/billing/setup-intent/route.js");

  assert.ok(route.includes("verifyIdToken(token, true)"));
  assert.ok(route.includes('collection("accounts").doc(decoded.uid).get()'));
  assert.ok(route.includes('account.status !== "pending_payment"'));
  assert.ok(route.includes("account.identityVerificationVerified !== true"));
  assert.ok(route.includes("account.businessSetupComplete !== true"));
  assert.ok(route.includes("let stripeCustomerId = text(account.stripeCustomerId)"));
  assert.ok(route.includes("stripe.customers.create({"));
  assert.ok(route.includes("stripe.setupIntents.create({"));
  assert.ok(route.includes('payment_method_types: ["card"]'));
  assert.ok(route.includes('usage: "off_session"'));
  assert.ok(route.includes('purpose: "ark_onboarding_payment_method"'));
  assert.ok(route.includes("idempotencyKey: `ark-onboarding-setup-${uid}-${paymentSetupAttempt}`"));
  assert.ok(route.includes("process.env.STRIPE_SECRET_KEY"));
  assert.ok(route.includes("process.env.STRIPE_PUBLISHABLE_KEY"));
  assert.equal(route.includes("await request.json"), false);
  assert.equal(route.includes("subscriptions.create"), false);
  assert.equal(route.includes("paymentIntents.create"), false);
  assert.equal(route.includes("prod_V30kc7tD7n7F"), false);
});

test("server verification prevents cross-account SetupIntent activation", async () => {
  const completion = await source("app/lib/ownerPaymentSetup.js");

  assert.ok(completion.includes("stripe.setupIntents.retrieve(safeSetupIntentId"));
  assert.ok(completion.includes('setupIntent.status !== "succeeded"'));
  assert.ok(completion.includes("customerId(setupIntent.customer) !== storedCustomerId"));
  assert.ok(completion.includes("text(account.stripeSetupIntentId) !== safeSetupIntentId"));
  assert.ok(completion.includes("text(setupIntent.metadata?.uid) !== safeUid"));
  assert.ok(completion.includes("text(setupIntent.metadata?.clientId) !== clientId"));
  assert.ok(completion.includes('text(setupIntent.metadata?.purpose) !== "ark_onboarding_payment_method"'));
  assert.ok(completion.includes('account.status !== "pending_payment"'));
  assert.ok(completion.includes("account.identityVerificationVerified !== true"));
  assert.ok(completion.includes("account.businessSetupComplete !== true"));
  assert.ok(completion.includes("invoice_settings: { default_payment_method: savedPaymentMethodId }"));
  assert.ok(completion.includes('status: "active"'));
  assert.ok(completion.includes('paymentSetupStatus: "complete"'));
  assert.equal(completion.includes("subscriptions.create"), false);
  assert.equal(completion.includes("paymentIntents.create"), false);
  assert.equal(completion.includes("charges.create"), false);
});

test("success status requires authentication and returns the existing home route", async () => {
  const route = await source("app/api/billing/setup-status/route.js");
  assert.ok(route.includes("verifyIdToken(token, true)"));
  assert.ok(route.includes("completeOwnerPaymentSetup({"));
  assert.ok(route.includes('message: "account set up complete"'));
  assert.ok(route.includes("process.env.APP_HOME_PATH"));
  assert.ok(route.includes('configured.startsWith("/") ? configured : "/"'));
  assert.ok(route.includes("your payment has failed update your payment method or try again later"));
});

test("Stripe webhook verifies the signature before processing setup success", async () => {
  const route = await source("app/api/billing/webhook/route.js");
  const signature = route.indexOf("stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)");
  const completion = route.indexOf("completeOwnerPaymentSetup({");
  assert.ok(route.includes("process.env.STRIPE_WEBHOOK_SECRET"));
  assert.ok(route.includes('request.headers.get("stripe-signature")'));
  assert.ok(signature >= 0 && completion > signature);
  assert.ok(route.includes('event.type === "setup_intent.succeeded"'));
  assert.equal(route.includes("JSON.parse(rawBody)"), false);
});

test("obsolete hosted payment handoff files no longer exist", async () => {
  const removed = [
    "app/api/billing/create-checkout-session/route.js",
    "app/api/signup/complete/route.js",
    "app/api/signup/finalize/route.js",
    "app/api/signup/status/route.js",
    "app/signup/complete/page.js",
    "app/signup/return/page.js",
    "app/signup/status/page.js",
    "app/components/AppUrlHandler.js",
    "app/lib/pendingOwnerSignup.js",
  ];
  for (const path of removed) {
    await assert.rejects(access(join(root, path)));
  }
});

test("retired multi-user account surface does not remain in source or documentation", async () => {
  const retiredWord = ["em", "ployee"].join("");
  const skippedDirectories = new Set([".git", ".next", "node_modules"]);
  const textExtensions = new Set([".css", ".example", ".gradle", ".html", ".java", ".js", ".json", ".jsx", ".kt", ".md", ".mjs", ".properties", ".rules", ".swift", ".ts", ".tsx", ".xml", ".yaml", ".yml"]);
  const matches = [];

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const relative = path.slice(root.length);
      if (relative.toLowerCase().includes(retiredWord)) matches.push(relative);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const extension = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : "";
      if (!textExtensions.has(extension)) continue;
      const contents = await readFile(path, "utf8");
      if (contents.toLowerCase().includes(retiredWord)) matches.push(relative);
    }
  }

  await walk(root);
  assert.deepEqual(matches, []);
});

test("business information remains compact and server-backed", async () => {
  const [page, form, settings, runtime] = await Promise.all([
    source("app/setup/business/page.js"),
    source("app/components/ReceptionistBusinessForm.js"),
    source("app/api/receptionist/settings/route.js"),
    source("app/api/receptionist/runtime/route.js"),
  ]);

  assert.ok(page.includes("onboardingMode"));
  assert.ok(page.includes('fetch("/api/receptionist/settings?onboarding=1"'));
  assert.equal(page.includes("sessionStorage"), false);
  assert.ok(form.includes('<option value="">Choose</option>'));
  assert.ok(form.includes('label="Estimate days"'));
  assert.ok(form.includes("Information title"));
  assert.ok(form.includes("Information details"));
  assert.ok(settings.includes("businessInformation: profile.businessInformation"));
  assert.ok(settings.includes("businessHours: FieldValue.delete()"));
  assert.ok(settings.includes("businessPhone: onboarding ? current.businessPhone"));
  assert.ok(settings.includes("businessEmail: onboarding ? current.businessEmail"));
  assert.ok(runtime.includes("extraInformation: businessInformationText(businessInformation)"));
});

test("verification expiry still uses the permanent account cleanup", async () => {
  const [deadline, cleanup, verification, workflow, gate] = await Promise.all([
    source("app/lib/accountVerificationDeadline.js"),
    source("app/lib/accountVerificationCleanup.js"),
    source("app/lib/accountVerification.js"),
    source("app/api/cron/workflow/route.js"),
    source("app/components/AccountVerificationGate.js"),
  ]);
  assert.ok(deadline.includes("60 * 60 * 1000"));
  assert.ok(verification.includes('throw new Error("ACCOUNT_VERIFICATION_EXPIRED")'));
  assert.ok(cleanup.includes('verificationCleanupStatus: "deleting"'));
  assert.ok(cleanup.includes("deleteCustomerPermanently"));
  assert.ok(workflow.includes("purgeExpiredUnverifiedAccounts({ db, now })"));
  assert.ok(gate.includes("Finish both verifications within"));
  assert.ok(gate.includes("scheduled for permanent deletion"));
});

test("activated accounts enter the existing number-assignment queue", async () => {
  const [completion, approval, connections] = await Promise.all([
    source("app/lib/ownerPaymentSetup.js"),
    source("app/api/admin/signup-applications/route.js"),
    source("app/connections/page.js"),
  ]);
  assert.ok(completion.includes('numberAssignmentStatus: "needed"'));
  assert.ok(approval.includes('document.data().status === "active"'));
  assert.ok(approval.includes('document.data().numberAssignmentStatus === "needed"'));
  assert.ok(approval.includes("connectionPhoneRegistry"));
  assert.ok(approval.includes("sendSignupText"));
  assert.ok(connections.includes("Needs a Number"));
  assert.ok(connections.includes("Assign Number"));
});

test("legal and setup documentation describe save-now and bill-later behavior", async () => {
  const [terms, privacy, setup, env] = await Promise.all([
    source("app/terms/page.js"),
    source("app/privacy/page.js"),
    source("SETUP.md"),
    source(".env.example"),
  ]);
  assert.ok(terms.includes("does not itself charge the payment method"));
  assert.ok(privacy.includes("Stripe’s Payment Element appears inside ARK Client Center"));
  assert.ok(setup.includes("The signup SetupIntent remains separate from subscription creation"));
  assert.ok(setup.includes("prod_V30kc7tD7n7F"));
  assert.ok(setup.includes("recurring `price_...`"));
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "YOUR_DOMAIN", "APP_HOME_PATH", "STRIPE_ACCOUNT_PRODUCT_ID", "STRIPE_ACCOUNT_BASE_PRICE_ID"]) {
    assert.ok(env.includes(`${name}=`));
  }
});
