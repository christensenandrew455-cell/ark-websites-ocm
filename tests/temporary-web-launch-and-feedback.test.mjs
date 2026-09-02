import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("website launch pricing is visible in the browser and enforced by the Stripe server", async () => {
  const [configuration, setup, payment, subscriptions, webhook] = await Promise.all([
    source("app/lib/temporaryFeatures.js"),
    source("app/api/billing/setup-intent/route.js"),
    source("app/signup/payment/PaymentSetupClient.js"),
    source("app/lib/stripePlanBilling.js"),
    source("app/api/billing/webhook/route.js"),
  ]);
  assert.ok(configuration.includes("acceptingNewAccounts: true"));
  assert.ok(configuration.includes('NATIVE_APP_USER_AGENT_MARKER = "ARKClientCenter/"'));
  assert.ok(setup.includes("webSignupPromotionForRequest(request, payment.billingPromotionKey)"));
  assert.ok(setup.includes("promotion: publicPromotion(promotion)"));
  assert.ok(payment.includes("SubscriptionPlanCard"));
  assert.ok(payment.includes("% off every plan through the website"));
  assert.ok(subscriptions.includes('duration: "forever"'));
  assert.ok(subscriptions.includes("discounts: [{ coupon: promotionCoupon.id }]") );
  assert.ok(webhook.includes("stripeSubscriptionAccountFields(expanded, match.business)"));
  assert.ok(subscriptions.includes("promotionBillingFields(plan, promotion)"));
});

test("Give Feedback is available to signed-in clients and saved for ARK Admin", async () => {
  const [configuration, settings, page, route, requests, privacy] = await Promise.all([
    source("app/lib/temporaryFeatures.js"),
    source("app/components/SettingsPanel.js"),
    source("app/feedback/page.js"),
    source("app/api/feedback/route.js"),
    source("app/api/requests/route.js"),
    source("app/privacy/page.js"),
  ]);
  assert.ok(configuration.includes("feedback: Object.freeze"));
  assert.ok(settings.includes('href="/feedback" title="Give Feedback"'));
  assert.ok(page.includes("What is it about?"));
  assert.ok(page.includes("How does this feel?"));
  assert.ok(route.includes('type: "feedback"'));
  assert.ok(route.includes('source: "client-center-feedback"'));
  assert.ok(route.includes('type: "feedback.created"'));
  assert.ok(requests.includes('["website", "feedback"].includes(item.type)'));
  assert.ok(privacy.includes("feedback topic and sentiment"));
});
