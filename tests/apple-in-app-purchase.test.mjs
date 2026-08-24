import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { appleIapCatalog, appleUsageProduct } from "../app/lib/appleIapCatalog.js";
import { computeBillingState } from "../app/lib/billingDelinquency.js";

function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("Apple catalog keeps the monthly plan and every referral-adjusted usage product fixed", () => {
  const catalog = appleIapCatalog();
  assert.equal(catalog.bundleId, "com.arkwebsites.clientcenter");
  assert.equal(catalog.base.productId, "com.arkwebsites.clientcenter.base.monthly");
  assert.equal(catalog.base.amountCents, 5000);
  assert.deepEqual(catalog.usage.map((item) => item.discountPercent), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(catalog.usage.map((item) => item.amountCents), [2000, 1800, 1600, 1400, 1200, 1000]);
  assert.equal(appleUsageProduct(37).productId, "com.arkwebsites.clientcenter.usage20.referral30");
  assert.equal(appleUsageProduct(99).discountPercent, 50);
});

test("the iOS bridge uses StoreKit 2 and leaves transaction completion to the verified server flow", async () => {
  const [plugin, manifest, config, project] = await Promise.all([
    source("native-plugins/ios/AppleIAPPlugin/AppleIAPPlugin.swift"),
    source("ios/App/CapApp-SPM/Package.swift"),
    source("ios/App/App/capacitor.config.json"),
    source("ios/App/App.xcodeproj/project.pbxproj"),
  ]);
  assert.ok(plugin.includes("import StoreKit"));
  assert.ok(plugin.includes("product.purchase(options: [.appAccountToken(accountToken)])"));
  assert.ok(plugin.includes("result.jwsRepresentation"));
  assert.ok(plugin.includes("Transaction.currentEntitlements"));
  assert.ok(plugin.includes("Transaction.unfinished"));
  const purchaseMethod = plugin.slice(plugin.indexOf('@objc func purchase'), plugin.indexOf('@objc func currentEntitlements'));
  assert.equal(purchaseMethod.includes("transaction.finish()"), false);
  assert.ok(manifest.includes('name: "AppleIAPPlugin"'));
  assert.ok(JSON.parse(config).packageClassList.includes("AppleIAPPlugin"));
  assert.ok(project.includes("com.apple.InAppPurchase = { enabled = 1; };"));
});

test("iPhone signup uses Apple while the existing Stripe checkout remains for other platforms", async () => {
  const [client, settings, shell, billingProvider] = await Promise.all([
    source("app/signup/payment/PaymentSetupClient.js"),
    source("app/components/SettingsPanel.js"),
    source("app/components/AppShell.js"),
    source("app/components/BillingStatusProvider.js"),
  ]);
  assert.ok(client.includes('appleIapAvailable() ? "apple" : "stripe"'));
  assert.ok(client.includes('"/api/billing/apple/configuration"'));
  assert.ok(client.includes('"/api/billing/apple/transactions"'));
  assert.ok(client.includes("Subscribe with Apple"));
  assert.ok(client.includes("Restore Purchases"));
  assert.ok(client.includes("automatically renews monthly"));
  assert.ok(client.includes("@stripe/react-stripe-js"));
  assert.ok(client.includes("<PaymentElement"));
  assert.ok(client.includes("stripe.confirmSetup({"));
  assert.ok(settings.includes("stripeManagedOutsideIos"));
  assert.ok(settings.includes("Billing changes for this existing account are not available inside the iPhone app."));
  assert.ok(shell.includes("!stripeManagedOutsideIos && <button"));
  assert.ok(billingProvider.includes('if (appleIapAvailable()) throw new Error("Billing changes for this existing account'));
});

test("Apple transactions are verified on the server and usage is never sent to Stripe", async () => {
  const [verifier, route, usage, appleUsage, notification] = await Promise.all([
    source("app/lib/appleIapVerification.js"),
    source("app/api/billing/apple/transactions/route.js"),
    source("app/lib/usageThresholdBilling.js"),
    source("app/lib/appleIapTransactions.js"),
    source("app/api/billing/apple/notifications/route.js"),
  ]);
  assert.ok(verifier.includes("new SignedDataVerifier("));
  assert.ok(verifier.includes("verifyAndDecodeTransaction"));
  assert.ok(verifier.includes("APPLE_IAP_BUNDLE_ID"));
  assert.ok(route.includes("sameAppleAccountToken"));
  assert.ok(route.includes("settleAppleUsagePurchase"));
  assert.ok(usage.indexOf('billingProvider) === "apple"') < usage.indexOf("const client = stripeClient(stripe)"));
  assert.ok(usage.includes('usageChargeStatus: "purchase_required"'));
  assert.ok(appleUsage.includes("firestoreTransaction.create(transactionRef"));
  assert.ok(appleUsage.includes("appleUsageCreditPoints"));
  assert.ok(notification.includes("verifySignedAppleNotification"));
  assert.ok(notification.includes('provider: "apple"'));
});

test("Apple billing recovery cannot delete an account while Apple may still retry renewal", () => {
  const failureAt = Date.parse("2026-08-01T12:00:00.000Z");
  const state = computeBillingState({ billingPastDue: true, billingProvider: "apple", billingFailureAt: new Date(failureAt) }, failureAt + 90 * 24 * 60 * 60 * 1000);
  assert.equal(state.phase, "payment_failed");
  assert.equal(state.appleManagedRecovery, true);
  assert.equal(state.recoveryEndsAt, 0);
});
