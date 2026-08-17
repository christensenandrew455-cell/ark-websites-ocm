import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("signed-in account data loads through one authenticated server profile", async () => {
  const [provider, route, settings] = await Promise.all([
    source("app/components/AuthProvider.js"),
    source("app/api/account/profile/route.js"),
    source("app/components/SettingsPanel.js"),
  ]);
  assert.ok(provider.includes('fetch("/api/account/profile"'));
  assert.equal(provider.includes("firebase/firestore"), false);
  assert.ok(route.includes('.collection("accounts").doc(clientId).get()'));
  assert.ok(route.includes("readPendingOwnerSignup({ db, uid: decodedToken.uid, clientId, allowExpired: true })"));
  assert.ok(route.includes("text(account.uid) !== text(decodedToken.uid)"));
  assert.ok(route.includes('"Cache-Control": "no-store"'));
  assert.ok(settings.includes("profile?.billingPastDue === true"));
  assert.equal(settings.includes("billingPastDue: true, paymentMethodLabel"), false);
});

test("leads load and save through the owner server route", async () => {
  const [component, route] = await Promise.all([
    source("app/components/ReviewClientsNative.js"),
    source("app/api/business/leads/route.js"),
  ]);
  assert.ok(component.includes('fetch("/api/business/leads"'));
  assert.ok(component.includes('method: "PATCH"'));
  assert.equal(component.includes("firebase/firestore"), false);
  assert.ok(route.includes('.collection("contactedMe").get()'));
  assert.ok(route.includes('.collection("clients").get()'));
  assert.ok(route.includes("leadContactFieldDeletionPatch(FieldValue.delete())"));
});

test("dashboard keeps number assignment and unavailable Messages copy simple", async () => {
  const [dashboard, messages] = await Promise.all([
    source("app/components/ClientStats.js"),
    source("app/lead-messages/page.js"),
  ]);
  assert.ok(dashboard.includes("Most businesses receive their number within 24–48 hours. Thank you for your patience."));
  assert.equal(dashboard.includes("Setup in progress"), false);
  assert.equal(dashboard.includes("keep setting up your account"), false);
  assert.ok(dashboard.includes('router.push("/lead-messages")'));
  assert.ok(messages.includes("Messages isn’t active yet"));
  assert.ok(messages.includes("It’ll be available next month."));
  assert.equal(messages.includes("nothing is wrong with your account"), false);
});

test("guided tour is eligible only for new accounts and is consumed on first open", async () => {
  const [tutorial, completion, profile] = await Promise.all([
    source("app/components/GuidedOnboarding.js"),
    source("app/lib/ownerPaymentSetup.js"),
    source("app/api/account/profile/route.js"),
  ]);
  assert.ok(tutorial.includes("ark-guided-onboarding-seen-v3"));
  assert.ok(tutorial.includes('body: JSON.stringify({ status: "started" })'));
  assert.ok(tutorial.includes("profile?.onboardingTourEligible === true"));
  assert.ok(completion.includes("onboardingTourEligible: true"));
  assert.ok(profile.includes("onboardingTourEligible: account.onboardingTourEligible === true"));
  assert.ok(tutorial.includes("const below = bottom + gap"));
  assert.ok(tutorial.includes("const above = top - panelHeight - gap"));
  assert.ok(tutorial.includes("onClick={runAction}"));
  assert.ok(tutorial.includes("The yellow outline marks the exact item."));
  assert.ok(tutorial.includes("new MutationObserver(locate)"));
});

test("customization keeps lead retention and lead status notices available before Messages launches", async () => {
  const [settings, retention, noticeRoute] = await Promise.all([
    source("app/components/SettingsPanel.js"),
    source("app/components/MessageRetentionSettings.js"),
    source("app/api/account/client-decline-notice/route.js"),
  ]);
  assert.ok(settings.includes("<MessageRetentionSettings showMessages={MESSAGES_AVAILABLE && features.messagesEnabled} />"));
  assert.ok(settings.includes("<ClientDeclineNoticeSettings />"));
  assert.ok(retention.includes('title="Leads" endpoint="/api/business/leads/retention"'));
  assert.equal(noticeRoute.includes("if (!MESSAGES_AVAILABLE)"), false);
  assert.ok(noticeRoute.includes("clientStatusNoticeEnabled"));
});

test("payment separates usage pricing from the recurring charge", async () => {
  const settings = await source("app/components/SettingsPanel.js");
  assert.ok(settings.includes("Usage toward next charge"));
  assert.ok(settings.includes("out of"));
  assert.ok(settings.includes(">New lead<"));
  assert.ok(settings.includes(">50 SMS parts<"));
  assert.ok(settings.includes("Recurring charge"));
  assert.ok(settings.includes("$50 per month"));
  assert.equal(settings.includes(">New chat<"), false);
  assert.equal(settings.includes("Last successful payment"), false);
});
