import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { billingPaymentDeadline } from "../app/lib/billingNotice.js";

test("unavailable dashboard features are non-interactive status cards", async () => {
  const source = await readFile(new URL("../app/components/ClientStats.js", import.meta.url), "utf8");
  assert.ok(source.includes('<div aria-disabled="true"'));
  assert.ok(source.includes("if (disabled)"));
  assert.ok(source.includes("disabled={!MESSAGES_AVAILABLE}"));
});

test("launch switch disables messaging across UI and APIs", async () => {
  const [switches, dashboard, settings, signup, messagingApi] = await Promise.all([
    readFile(new URL("../app/lib/launchFeatures.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ClientStats.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SettingsPanel.js", import.meta.url), "utf8"),
    readFile(new URL("../app/signup/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/business/lead-messages/route.js", import.meta.url), "utf8"),
  ]);

  assert.ok(switches.includes('messages: "off"'));
  assert.ok(dashboard.includes('value={MESSAGES_AVAILABLE ? unreadMessages : ""}'));
  assert.ok(dashboard.includes("disabled={!MESSAGES_AVAILABLE}"));
  assert.ok(settings.includes("MESSAGES_AVAILABLE && <label"));
  assert.equal(signup.includes("MESSAGES_AVAILABLE"), false);
  assert.ok(messagingApi.includes("if (!MESSAGES_AVAILABLE)"));
});

test("login and both signup password fields use tappable visibility controls", async () => {
  const [inputSource, loginSource, signupSource] = await Promise.all([
    readFile(new URL("../app/components/PasswordInput.js", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/signup/page.js", import.meta.url), "utf8"),
  ]);

  assert.ok(inputSource.includes('type={visible ? "text" : "password"}'));
  assert.ok(inputSource.includes('visible ? "Hide password" : "Show password"'));
  assert.ok(inputSource.includes("aria-pressed={visible}"));
  assert.equal((loginSource.match(/<PasswordInput/g) || []).length, 1);
  assert.equal((signupSource.match(/<PasswordInput/g) || []).length, 2);
});

test("payment warnings show the plain message, recovery deadline, and payment update action", async () => {
  const source = await readFile(new URL("../app/components/AppShell.js", import.meta.url), "utf8");
  assert.ok(source.includes("You need to update your payment method."));
  assert.ok(source.includes("Update before"));
  assert.ok(source.includes("Payment status couldn’t refresh"));
  assert.ok(source.includes("Try again"));
  assert.ok(source.includes("Update Payment Method"));

  assert.equal(billingPaymentDeadline({
    recoveryEndsAt: "2026-08-20T12:00:00.000Z",
  }), "2026-08-20T12:00:00.000Z");
});

test("help, legal pages, and every mobile scroll surface stay clear of system UI", async () => {
  const [shell, helpPage, terms, privacy, legalHeader, androidSetup, globals, mobileViewport, modalOverlays] = await Promise.all([
    readFile(new URL("../app/components/AppShell.js", import.meta.url), "utf8"),
    readFile(new URL("../app/help/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LegalPageHeader.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/configure-android.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-viewport.css", import.meta.url), "utf8"),
    readFile(new URL("../app/modal-overlays.css", import.meta.url), "utf8"),
  ]);

  assert.equal(shell.includes("HelpCenter"), false);
  assert.ok(helpPage.includes("<HelpCenter />"));
  assert.ok(terms.indexOf("<LegalBackButton />") < terms.indexOf("<article"));
  assert.ok(privacy.indexOf("<LegalBackButton />") < privacy.indexOf("<article"));
  assert.ok(legalHeader.includes("export function LegalBackButton"));
  assert.ok(androidSetup.includes("WindowInsetsCompat.Type.navigationBars()"));
  assert.ok(androidSetup.includes("BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE"));
  assert.ok(androidSetup.includes("public void onResume()"));
  assert.equal(androidSetup.includes("WindowInsetsCompat.Type.systemBars()"), false);
  assert.ok(globals.includes("--safe-area-inset-bottom"));
  assert.ok(globals.includes("--ark-bottom-scroll-clearance"));
  assert.ok(globals.includes("body::after"));
  assert.ok(mobileViewport.includes("padding-bottom: var(--ark-bottom-scroll-clearance)"));
  assert.ok(modalOverlays.includes("var(--ark-bottom-scroll-clearance)"));
});
