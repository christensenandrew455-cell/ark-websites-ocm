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
  assert.equal(route.includes("sendEstimateRequestReceivedNotice"), false);
  assert.equal(route.includes("confirmationText"), false);
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

test("unreleased messaging is described only on the disabled dashboard button", async () => {
  const [{ HELP_SECTIONS }, terms, messagingApi] = await Promise.all([
    import(new URL("../app/lib/helpContent.js", import.meta.url)),
    source("app/terms/page.js"),
    source("app/api/business/lead-messages/route.js"),
  ]);
  const visibleHelp = JSON.stringify(HELP_SECTIONS);
  assert.equal(visibleHelp.includes("Messages"), false);
  assert.equal(visibleHelp.toLowerCase().includes("messaging"), false);
  assert.equal(visibleHelp.includes("SMS-part"), false);
  assert.equal(terms.includes("SMS-part progress"), false);
  assert.equal(messagingApi.includes("UPCOMING_FEATURE_LABEL"), false);
});

test("first-visit guides are contextual and their progress is persisted in Firestore", async () => {
  const [tutorial, completion, profile, tourRoute, accountSections] = await Promise.all([
    source("app/components/GuidedOnboarding.js"),
    source("app/lib/ownerPaymentSetup.js"),
    source("app/api/account/profile/route.js"),
    source("app/api/account/onboarding-tour/route.js"),
    source("app/lib/accountSections.js"),
  ]);
  assert.equal(tutorial.includes("localStorage"), false);
  assert.equal(tutorial.includes("sessionStorage"), false);
  assert.ok(tutorial.includes('["pending", "started"].includes(legacyStatus)'));
  assert.ok(tutorial.includes('body: JSON.stringify({ guide: dismissed.id })'));
  assert.ok(tutorial.includes("profile.onboardingTourEligible !== true"));
  assert.ok(tutorial.includes("Welcome to your ARK Client Center"));
  assert.ok(tutorial.includes("“Contacted You” holds new leads"));
  assert.ok(tutorial.includes("“Settings,” then “Payment.”"));
  assert.equal(tutorial.includes("Messages is not available"), false);
  assert.ok(tutorial.includes("Review your monthly accepted-lead plan, accepted leads remaining, and payment method."));
  assert.ok(tutorial.includes("Tap anywhere to continue"));
  assert.ok(tutorial.includes('id: "number-assigned"'));
  assert.ok(tutorial.includes("reap the benefits of the app"));
  for (const retiredCopy of ["Quick tour", "Open Settings", "Open Dashboard", "Finding this item…", ">Skip<", ">Next<"]) assert.equal(tutorial.includes(retiredCopy), false);
  assert.equal(tutorial.includes("Tap the highlighted item."), false);
  assert.equal(tutorial.includes("MutationObserver"), false);
  assert.equal(tutorial.includes("data-tour-id"), false);
  assert.ok(completion.includes("onboardingTourEligible: true"));
  assert.ok(completion.includes('onboardingTourStatus: "pending"'));
  assert.ok(completion.includes("onboardingGuideVersion: 2"));
  assert.ok(completion.includes("onboardingGuideSeen: { dashboard: false, settings: false, leads: false }"));
  assert.ok(profile.includes("onboardingTourEligible: account.onboardingTourEligible === true"));
  assert.ok(profile.includes("onboardingGuideSeen: onboardingGuideSeen(account.onboardingGuideSeen)"));
  assert.ok(tourRoute.includes("sections.customizationRef"));
  assert.ok(tourRoute.includes("onboardingGuideSeen: seen"));
  assert.ok(tourRoute.includes("onboardingNumberGuidePhone: assignedPhone"));
  for (const field of ["onboardingGuideVersion", "onboardingGuideSeen", "onboardingNumberGuidePhone"]) assert.ok(accountSections.includes(`"${field}"`));
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

test("payment keeps other plans behind the two-part manager", async () => {
  const [settings, manager] = await Promise.all([
    source("app/components/SettingsPanel.js"),
    source("app/components/PaymentManagementPanel.js"),
  ]);
  assert.ok(settings.includes("Accepted leads left this month"));
  assert.ok(settings.includes("Monthly accepted leads remaining"));
  assert.ok(settings.includes("acceptedLeadsRemaining"));
  assert.ok(settings.includes("Current plan"));
  assert.equal(settings.includes("Available monthly plans"), false);
  assert.ok(settings.includes("Manage Plan & Payment"));
  assert.ok(settings.includes('planSummary?.planName || "Starter"} Plan'));
  assert.ok(manager.includes('title="Select a Plan"'));
  assert.ok(manager.includes('title="Edit Card Information"'));
  assert.ok(manager.includes("Selected — not changed yet"));
  assert.ok(manager.includes("Review Plan Change"));
  assert.equal(settings.includes("Accepted lead"), true);
  assert.equal(settings.includes("Referral discount"), false);
  const summaryRoute = await source("app/api/billing/plan-summary/route.js");
  assert.ok(summaryRoute.includes("publicAcceptedLeadPlanSummary(account, new Date(), currentAcceptedClients)"));
  assert.ok(summaryRoute.includes('billingProvider: String(account.billingProvider'));
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
