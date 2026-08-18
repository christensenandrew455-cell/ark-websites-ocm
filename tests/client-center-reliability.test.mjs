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

test("lead intake saves the lead and its account activity metadata", async () => {
  const route = await source("app/api/intake/route.js");
  assert.ok(route.includes("batch.create(targetRef"));
  assert.ok(route.includes("batch.set(accountSnapshot.ref"));
  assert.ok(route.includes("sendEstimateRequestReceivedNotice"));
  assert.ok(route.includes("data.consentToContact === true"));
  assert.equal(route.includes("connectionSnapshot"), false);
});

test("dashboard keeps number assignment simple and does not open unavailable Messages", async () => {
  const [dashboard, messages] = await Promise.all([
    source("app/components/ClientStats.js"),
    source("app/lead-messages/page.js"),
  ]);
  assert.ok(dashboard.includes("Most numbers arrive within 24–48 hours."));
  assert.equal(dashboard.includes("Setup in progress"), false);
  assert.equal(dashboard.includes("keep setting up your account"), false);
  assert.equal(dashboard.includes('router.push("/lead-messages")'), false);
  assert.ok(dashboard.includes("disabled={!MESSAGES_AVAILABLE}"));
  assert.ok(messages.includes('if (!MESSAGES_AVAILABLE) router.replace("/")'));
  assert.ok(messages.includes("if (!MESSAGES_AVAILABLE) return null"));
});

test("guided tour eligibility and completion are persisted in Firestore", async () => {
  const [tutorial, completion, profile, tourRoute] = await Promise.all([
    source("app/components/GuidedOnboarding.js"),
    source("app/lib/ownerPaymentSetup.js"),
    source("app/api/account/profile/route.js"),
    source("app/api/account/onboarding-tour/route.js"),
  ]);
  assert.equal(tutorial.includes("localStorage"), false);
  assert.equal(tutorial.includes("sessionStorage"), false);
  assert.ok(tutorial.includes('["pending", "started"].includes(profile?.onboardingTourStatus)'));
  assert.ok(tutorial.includes('body: JSON.stringify({ status: "started" })'));
  assert.ok(tutorial.includes("profile?.onboardingTourEligible === true"));
  assert.ok(completion.includes("onboardingTourEligible: true"));
  assert.ok(completion.includes('onboardingTourStatus: "pending"'));
  assert.ok(profile.includes("onboardingTourEligible: account.onboardingTourEligible === true"));
  assert.ok(tourRoute.includes("sections.customizationRef"));
  assert.ok(tourRoute.includes("onboardingTourStatus: status"));
  assert.ok(tutorial.includes("const below = bottom + gap"));
  assert.ok(tutorial.includes("const above = top - panelHeight - gap"));
  assert.ok(tutorial.includes("onClick={runAction}"));
  assert.ok(tutorial.includes("Tap the highlighted item."));
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
  assert.ok(retention.includes('title="Clients" endpoint="/api/business/clients/retention"'));
  assert.equal(noticeRoute.includes("if (!MESSAGES_AVAILABLE)"), false);
  assert.ok(noticeRoute.includes("clientStatusNoticeEnabled"));
});

test("payment separates usage pricing from the recurring charge", async () => {
  const settings = await source("app/components/SettingsPanel.js");
  assert.ok(settings.includes("Usage toward next charge"));
  assert.ok(settings.includes("out of"));
  assert.ok(settings.includes(">Accepted lead<"));
  assert.ok(settings.includes("Declined leads are free"));
  assert.ok(settings.includes(">50 SMS parts<"));
  assert.ok(settings.includes("Recurring charge"));
  assert.ok(settings.includes("$50 per month"));
  assert.equal(settings.includes(">New chat<"), false);
  assert.equal(settings.includes("Last successful payment"), false);
  const summaryRoute = await source("app/api/billing/usage-summary/route.js");
  assert.equal(summaryRoute.includes("chatPoints"), false);
});

test("business information auto-saves edits and flushes the latest change before going back", async () => {
  const [settings, form] = await Promise.all([
    source("app/components/SettingsPanel.js"),
    source("app/components/ReceptionistBusinessForm.js"),
  ]);
  assert.ok(settings.includes("BUSINESS_AUTO_SAVE_DELAY_MS"));
  assert.ok(settings.includes("queueBusinessSave(receptionist)"));
  assert.ok(settings.includes("queueBusinessSave(latest)"));
  assert.ok(settings.includes("savedReceptionistRef.current"));
  assert.ok(settings.includes("options.saveImmediately"));
  assert.equal(settings.includes("All changes saved"), false);
  assert.equal(settings.includes("businessSaveStatus"), false);
  assert.ok(form.includes("{ saveImmediately: true }"));
});

test("business settings replace the Firestore services map so removed services stay removed", async () => {
  const route = await source("app/api/receptionist/settings/route.js");
  assert.ok(route.includes("services: profile.services"));
  assert.ok(route.includes("batch.set(loaded.businessRef"));
  assert.ok(route.includes("batch.update(loaded.ref"));
  assert.equal(route.includes("batch.set(loaded.businessRef") && route.includes("{ merge: true }"), false);
});

test("customization changes save immediately through a serialized Firestore queue", async () => {
  const settings = await source("app/components/SettingsPanel.js");
  assert.ok(settings.includes("customizationSaveQueueRef"));
  assert.ok(settings.includes("queueCustomizationSave({ features: nextFeatures"));
  assert.ok(settings.includes("queueCustomizationSave({ features: featuresRef.current, darkMode: checked })"));
  assert.ok(settings.includes('fetch("/api/account/features"'));
  assert.ok(settings.includes("keepalive: true"));
});

test("profile refreshes keep the existing client center visible", async () => {
  const provider = await source("app/components/AuthProvider.js");
  const refreshBlock = provider.slice(provider.indexOf("const refreshProfile"), provider.indexOf("const updateProfile"));
  assert.equal(refreshBlock.includes("setLoading(true)"), false);
  assert.equal(refreshBlock.includes("setLoading(false)"), false);
  assert.ok(provider.includes("updateProfile"));
});
