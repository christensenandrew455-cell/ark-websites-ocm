import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("onboarding follows main information, business, payment, then verification", async () => {
  const [signup, business, payment, verification, shell] = await Promise.all([
    source("app/signup/page.js"),
    source("app/setup/business/page.js"),
    source("app/signup/payment/PaymentSetupClient.js"),
    source("app/components/AccountVerificationGate.js"),
    source("app/components/SignupFlowShell.js"),
  ]);
  assert.ok(signup.includes("Step 1 of 4 · Main information"));
  assert.ok(signup.includes('router.replace(data.nextPath || "/setup/business")'));
  assert.ok(business.includes("Step 2 of 4 · Business information"));
  assert.ok(business.includes('router.push(data.nextPath || "/signup/payment")'));
  assert.ok(payment.includes("Step 3 of 4 · Payment"));
  assert.ok(payment.includes('data.nextPath || "/signup/verify"'));
  assert.ok(verification.includes("Step 4 of 4 · Verify"));
  assert.ok(verification.includes('window.location.replace(next.nextPath || "/")'));
  assert.ok(shell.includes('status === "pending_business_setup"'));
  assert.ok(shell.includes('status === "pending_payment"'));
  assert.ok(shell.includes('profile?.identityVerificationRequired'));
});

test("main information creates only a short-lived temporary signup", async () => {
  const route = await source("app/api/signup/apply/route.js");
  const pending = await source("app/lib/pendingOwnerSignup.js");
  assert.ok(route.includes("auth.createUser({"));
  assert.ok(route.includes("createPendingOwnerSignup({"));
  assert.ok(route.includes("role: ACCOUNT_ROLES.STANDARD"));
  assert.ok(route.includes('accountStatus: "pending_business_setup"'));
  assert.ok(route.includes("temporaryAccount: true"));
  assert.equal(route.includes('collection("accounts")'), false);
  assert.equal(route.includes('collection("businesses")'), false);
  assert.equal(route.includes("sendAccountVerificationCodes"), false);
  assert.equal(route.includes("new Stripe("), false);
  assert.ok(pending.includes('PENDING_OWNER_SIGNUP_COLLECTION = "pendingOwnerSignups"'));
  assert.ok(pending.includes("PENDING_OWNER_SIGNUP_TTL_MS = 60 * 60 * 1000"));
  assert.ok(pending.includes("transaction.create(pendingRef, data)"));
  assert.equal(pending.includes("businessNameRegistry"), false);
  assert.equal(pending.includes("accountPhoneRegistry"), false);
});

test("business setup is saved into the temporary record before payment", async () => {
  const [page, route] = await Promise.all([source("app/setup/business/page.js"), source("app/api/signup/draft/route.js")]);
  assert.ok(page.includes('fetch("/api/signup/draft"'));
  assert.equal(page.includes("sessionStorage"), false);
  assert.ok(route.includes("readPendingOwnerSignup"));
  assert.ok(route.includes("validateReceptionistBusinessInformation"));
  assert.ok(route.includes('stage: "pending_payment"'));
  assert.ok(route.includes("businessSetupComplete: true"));
  assert.ok(route.includes('accountStatus: "pending_payment"'));
  assert.ok(route.includes("export async function DELETE"));
});

test("business-name login resumes temporary setup while regular accounts have two statuses", async () => {
  const route = await source("app/api/auth/business-login/route.js");
  assert.ok(route.includes('REGULAR_ACCOUNT_STATUSES = new Set(["active", "disabled"])'));
  assert.ok(route.includes("readPendingOwnerSignup({ db, clientId, allowExpired: true })"));
  assert.ok(route.includes('temporary: true'));
  assert.ok(route.includes('["pending_business_setup", "pending_payment"].includes(stage)'));
  for (const retiredStatus of ["pending_verification", "pending_admin_approval", "approved_pending_payment"]) {
    assert.equal(route.includes(retiredStatus), false);
  }
});

test("payment setup is tied to the authenticated temporary owner", async () => {
  const route = await source("app/api/billing/setup-intent/route.js");
  assert.ok(route.includes("verifyIdToken(token, true)"));
  assert.ok(route.includes("decoded.temporaryAccount !== true"));
  assert.ok(route.includes("readPendingOwnerSignup"));
  assert.ok(route.includes('text(decoded.accountStatus) !== "pending_payment"'));
  assert.ok(route.includes("let stripeCustomerId = text(payment.stripeCustomerId)"));
  assert.ok(route.includes("stripe.customers.create({"));
  assert.ok(route.includes("stripe.setupIntents.create({"));
  assert.ok(route.includes('payment_method_types: ["card"]'));
  assert.ok(route.includes('usage: "off_session"'));
  assert.ok(route.includes('purpose: "ark_onboarding_payment_method"'));
  assert.equal(route.includes('collection("accounts")'), false);
});

test("successful payment promotes temp data, starts only the base subscription, then sends codes", async () => {
  const [completion, subscription] = await Promise.all([source("app/lib/ownerPaymentSetup.js"), source("app/lib/stripeUsageBilling.js")]);
  assert.ok(completion.includes("stripe.setupIntents.retrieve(safeSetupIntentId"));
  assert.ok(completion.includes('setupIntent.status !== "succeeded"'));
  assert.ok(completion.includes("customerId(setupIntent.customer) !== storedCustomerId"));
  assert.ok(completion.includes("text(payment.stripeSetupIntentId) !== safeSetupIntentId"));
  assert.ok(completion.includes("text(setupIntent.metadata?.uid) !== safeUid"));
  assert.ok(completion.includes("ensureCustomerBillingSubscription({"));
  assert.ok(completion.includes("createIfMissing: true"));
  assert.ok(completion.includes("batch.create(accountRef, accountData)"));
  assert.ok(completion.includes("batch.delete(pending.ref)"));
  assert.ok(completion.includes("sendAccountVerificationCodes({"));
  assert.ok(completion.indexOf("batch.delete(pending.ref)") < completion.indexOf("sendAccountVerificationCodes({"));
  assert.ok(completion.includes("usageBalancePoints: 0"));
  assert.ok(completion.includes("usageSmsPartRemainder: 0"));
  assert.ok(completion.includes('role: ACCOUNT_ROLES.STANDARD'));
  assert.ok(subscription.includes("return [catalog.basePriceId]"));
  assert.equal(subscription.includes("await configRef.set"), false);
});

test("verification hashes both codes and refreshes the standard role before navigation", async () => {
  const [verification, route, gate] = await Promise.all([
    source("app/lib/accountVerification.js"),
    source("app/api/account/verification/route.js"),
    source("app/components/AccountVerificationGate.js"),
  ]);
  assert.ok(verification.includes('codeHash(uid, "email"'));
  assert.ok(verification.includes('codeHash(uid, "phone"'));
  assert.ok(verification.includes("ACCOUNT_VERIFICATION_SECRET"));
  assert.ok(verification.includes("role: ACCOUNT_ROLES.STANDARD"));
  assert.ok(route.includes("isStandardRole(account.role)"));
  assert.ok(route.includes('account.status !== "active"'));
  assert.ok(route.includes("verifyAccountCodes"));
  assert.ok(gate.includes("await user.getIdToken(true)"));
  assert.ok(gate.includes("!status?.verified && deadlineWait !== null"));
  assert.ok(gate.includes('window.location.replace(next.nextPath || "/")'));
});

test("payment page uses Stripe Payment Element without raw card fields", async () => {
  const client = await source("app/signup/payment/PaymentSetupClient.js");
  assert.ok(client.includes("@stripe/react-stripe-js"));
  assert.ok(client.includes("<PaymentElement"));
  assert.ok(client.includes("stripe.confirmSetup({"));
  assert.ok(client.includes('redirect: "if_required"'));
  assert.ok(client.includes("Pay & Continue"));
  assert.equal(client.includes('name="cardNumber"'), false);
  assert.equal(client.includes('name="cvc"'), false);
});

test("Stripe webhook verifies its signature before setup completion", async () => {
  const route = await source("app/api/billing/webhook/route.js");
  const signature = route.indexOf("stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)");
  const completion = route.indexOf("completeOwnerPaymentSetup({");
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
  ];
  for (const path of removed) await assert.rejects(access(join(root, path)));
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
      if (entry.isDirectory()) { await walk(path); continue; }
      const extension = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : "";
      if (!textExtensions.has(extension)) continue;
      if ((await readFile(path, "utf8")).toLowerCase().includes(retiredWord)) matches.push(relative);
    }
  }
  await walk(root);
  assert.deepEqual(matches, []);
});

test("temporary and unverified accounts both have permanent cleanup workflows", async () => {
  const [pending, cleanup, workflow] = await Promise.all([
    source("app/lib/pendingOwnerSignup.js"),
    source("app/lib/accountVerificationCleanup.js"),
    source("app/api/cron/workflow/route.js"),
  ]);
  assert.ok(pending.includes("purgeExpiredPendingOwnerSignups"));
  assert.ok(pending.includes("deletePendingOwnerSignup"));
  assert.ok(pending.includes("deletePendingStripeCustomer"));
  assert.ok(cleanup.includes("deleteCustomerPermanently"));
  assert.ok(workflow.includes("purgeExpiredPendingOwnerSignups({ db, auth: getAdminAuth(), now })"));
  assert.ok(workflow.includes("purgeExpiredUnverifiedAccounts({ db, now })"));
});

test("regular accounts enter the existing number-assignment queue", async () => {
  const completion = await source("app/lib/ownerPaymentSetup.js");
  assert.ok(completion.includes('numberAssignmentStatus: "needed"'));
  assert.equal(completion.includes("NumberAssignmentStatus"), false);
});

test("legal and help copy describe threshold billing and immediate enforcement", async () => {
  const [terms, privacy, help, env] = await Promise.all([source("app/terms/page.js"), source("app/privacy/page.js"), source("app/lib/helpContent.js"), source(".env.example")]);
  assert.ok(terms.includes("$20 usage threshold"));
  assert.ok(terms.includes("Immediate pause"));
  assert.ok(terms.includes("Seven-day recovery window"));
  assert.ok(privacy.includes("promotes the temporary signup into a regular account"));
  assert.ok(help.includes("starts the $50 monthly subscription"));
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "YOUR_DOMAIN", "APP_HOME_PATH", "STRIPE_ACCOUNT_PRODUCT_ID", "STRIPE_ACCOUNT_BASE_PRICE_ID"]) assert.ok(env.includes(`${name}=`));
});
