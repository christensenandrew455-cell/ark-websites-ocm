import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appleIapCatalog, applePlanForProduct, isAppleAcceptedLeadTopUpProduct } from "../app/lib/appleIapCatalog.js";
import { computeBillingState } from "../app/lib/billingDelinquency.js";

function source(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("Apple exposes the same four monthly accepted-lead plans under the shared app identifier", () => {
  const catalog = appleIapCatalog();
  assert.equal(catalog.bundleId, "com.arkwebsites.app");
  assert.deepEqual(catalog.plans.map(({ key, monthlyAcceptedLeads, amountCents, productId }) => ({ key, monthlyAcceptedLeads, amountCents, productId })), [
    { key: "starter", monthlyAcceptedLeads: 25, amountCents: 2499, productId: "com.arkwebsites.app.starter.monthly" },
    { key: "standard", monthlyAcceptedLeads: 50, amountCents: 4749, productId: "com.arkwebsites.app.standard.monthly" },
    { key: "growth", monthlyAcceptedLeads: 100, amountCents: 8999, productId: "com.arkwebsites.app.growth.monthly" },
    { key: "scale", monthlyAcceptedLeads: 200, amountCents: 16999, productId: "com.arkwebsites.app.pro.monthly" },
  ]);
  assert.equal(applePlanForProduct("com.arkwebsites.app.pro.monthly").key, "scale");
  assert.equal(applePlanForProduct("com.arkwebsites.app.unknown"), null);
  assert.deepEqual(catalog.acceptedLeadTopUp, {
    productId: "com.arkwebsites.app.accepted-lead-top-up",
    amountCentsPerLead: 100,
    type: "consumable",
  });
  assert.equal(isAppleAcceptedLeadTopUpProduct(catalog.acceptedLeadTopUp.productId), true);
});

test("the iOS bridge uses StoreKit 2 and leaves completion to the verified server flow", async () => {
  const [plugin, manifest, config, project, plist] = await Promise.all([
    source("native-plugins/ios/AppleIAPPlugin/AppleIAPPlugin.swift"),
    source("ios/App/CapApp-SPM/Package.swift"),
    source("ios/App/App/capacitor.config.json"),
    source("ios/App/App.xcodeproj/project.pbxproj"),
    source("ios/App/App/Info.plist"),
  ]);
  assert.ok(plugin.includes("import StoreKit"));
  assert.ok(plugin.includes("product.purchase(options: [.appAccountToken(accountToken)])"));
  assert.ok(plugin.includes("result.jwsRepresentation"));
  assert.ok(plugin.includes("Transaction.currentEntitlements"));
  assert.ok(plugin.includes("Transaction.unfinished"));
  assert.ok(plugin.includes(".quantity(quantity)"));
  assert.ok(plugin.includes("transaction.purchasedQuantity"));
  const purchaseMethod = plugin.slice(plugin.indexOf('@objc func purchase'), plugin.indexOf('@objc func currentEntitlements'));
  assert.equal(purchaseMethod.includes("transaction.finish()"), false);
  assert.ok(manifest.includes('name: "AppleIAPPlugin"'));
  assert.ok(JSON.parse(config).packageClassList.includes("AppleIAPPlugin"));
  assert.equal(JSON.parse(config).appId, "com.arkwebsites.app");
  assert.ok(project.includes("com.apple.InAppPurchase = { enabled = 1; };"));
  assert.ok(project.includes("PRODUCT_BUNDLE_IDENTIFIER = com.arkwebsites.app;"));
  assert.ok(plist.includes("<string>com.arkwebsites.app</string>"));
});

test("iPhone signup and account management use Apple while other platforms keep Stripe", async () => {
  const [client, configuration, settings, manager] = await Promise.all([
    source("app/signup/payment/PaymentSetupClient.js"),
    source("app/api/billing/apple/configuration/route.js"),
    source("app/components/SettingsPanel.js"),
    source("app/components/PaymentManagementPanel.js"),
  ]);
  assert.ok(client.includes('appleIapAvailable() ? "apple" : "stripe"'));
  assert.ok(client.includes("Choose a monthly plan"));
  assert.ok(client.includes('body: JSON.stringify({ planKey: selectedPlanKey })'));
  assert.ok(client.includes('"/api/billing/apple/transactions"'));
  assert.ok(client.includes("Restore purchases"));
  assert.ok(client.includes("automatically renews monthly"));
  assert.ok(client.includes("@stripe/react-stripe-js"));
  assert.ok(client.includes("<PaymentElement"));
  assert.ok(configuration.includes("applePlanProduct(planKey)"));
  assert.ok(configuration.includes("plans: catalog.plans"));
  assert.ok(settings.includes('SectionHeader title="Plan and payment"'));
  assert.ok(manager.includes("Continue with Apple"));
  assert.ok(manager.includes("Open Apple payment settings"));
  assert.ok(manager.includes("quantity: purchaseQuantity"));
  assert.ok(manager.includes("Math.min(10, remaining)"));
});

test("Apple transactions verify subscriptions and idempotent lead top-ups", async () => {
  const [verifier, route, transactions, notification, signup] = await Promise.all([
    source("app/lib/appleIapVerification.js"),
    source("app/api/billing/apple/transactions/route.js"),
    source("app/lib/appleIapTransactions.js"),
    source("app/api/billing/apple/notifications/route.js"),
    source("app/lib/ownerApplePaymentSetup.js"),
  ]);
  assert.ok(verifier.includes("new SignedDataVerifier("));
  assert.ok(verifier.includes("verifyAndDecodeTransaction"));
  assert.ok(verifier.includes("APPLE_IAP_BUNDLE_ID"));
  assert.ok(route.includes("sameAppleAccountToken"));
  assert.ok(route.includes("isApplePlanProduct"));
  assert.ok(route.includes("isAppleAcceptedLeadTopUpProduct"));
  assert.ok(route.includes("grantAcceptedLeadTopUp"));
  assert.equal(route.includes("settleAppleUsagePurchase"), false);
  assert.ok(transactions.includes("applePlanForProduct"));
  assert.ok(transactions.includes("acceptedLeadsUsedThisPeriod: acceptedLeadsUsed"));
  assert.ok(transactions.includes("acceptedLeadsRemainingThisPeriod"));
  assert.ok(transactions.includes("samePeriodEnd && !planChanged"));
  assert.ok(transactions.includes("reportRevenuePayment"));
  assert.ok(transactions.includes("amountCents,"));
  assert.ok(signup.includes("reportRevenuePayment"));
  assert.ok(signup.includes('eventId: `billing-paid-apple-${transactionId}`'));
  assert.equal(transactions.includes("CreditPoints"), false);
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
