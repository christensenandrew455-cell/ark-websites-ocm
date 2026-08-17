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

test("dashboard explains number assignment and makes the Messages question mark useful", async () => {
  const [dashboard, messages] = await Promise.all([
    source("app/components/ClientStats.js"),
    source("app/lead-messages/page.js"),
  ]);
  assert.ok(dashboard.includes("Most numbers are assigned within 24–48 hours"));
  assert.ok(dashboard.includes("Setup in progress"));
  assert.ok(dashboard.includes('router.push("/lead-messages")'));
  assert.ok(messages.includes("The question mark on the dashboard means Messages is not active yet"));
});

test("guided tour keeps its card away from the highlighted target and every highlight acts", async () => {
  const tutorial = await source("app/components/GuidedOnboarding.js");
  assert.ok(tutorial.includes("ark-guided-onboarding-pending-v2"));
  assert.ok(tutorial.includes("const below = bottom + gap"));
  assert.ok(tutorial.includes("const above = top - panelHeight - gap"));
  assert.ok(tutorial.includes("onClick={runAction}"));
  assert.ok(tutorial.includes("The yellow outline marks the exact item."));
  assert.ok(tutorial.includes("new MutationObserver(locate)"));
});
