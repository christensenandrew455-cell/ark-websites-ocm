import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("question-mark help is accessible and closes without changing a form", async () => {
  const infoTip = await source("app/components/InfoTip.js");
  assert.ok(infoTip.includes('type="button"'));
  assert.ok(infoTip.includes("aria-expanded={open}"));
  assert.ok(infoTip.includes("aria-controls={id}"));
  assert.ok(infoTip.includes('role="tooltip"'));
  assert.ok(infoTip.includes('event.key === "Escape"'));
  assert.ok(infoTip.includes("pointerdown"));
});

test("obvious business fields stay bare while non-obvious settings use help", async () => {
  const form = await source("app/components/ReceptionistBusinessForm.js");
  for (const label of ["Business name", "Owner name", "Business phone", "Business email", "Type of business"]) {
    assert.equal(form.includes(`label="${label}" explanation=`), false);
  }
  assert.ok(form.includes('label="Regular scheduling" explanation='));
  assert.ok(form.includes('label="Emergency requests" explanation='));
  assert.ok(form.includes('label="Service area" explanation='));
  assert.ok(form.includes('label="Additional business information" explanation='));
  assert.equal(form.includes("Normal projects and non-urgent requests can always be scheduled"), false);
});

test("routine page tours are removed and only number assignment interrupts the owner", async () => {
  const guide = await source("app/components/GuidedOnboarding.js");
  assert.equal(guide.includes("PAGE_GUIDES"), false);
  assert.equal(guide.includes("pageGuide(pathname)"), false);
  assert.ok(guide.includes('id: "number-assigned"'));
  assert.ok(guide.includes("Your ARK number is ready"));
});

test("AI Chat reads app docs, Terms, and Privacy from explicit knowledge sources", async () => {
  const [route, legal, { HELP_SECTIONS }] = await Promise.all([
    source("app/api/help/route.js"),
    source("app/lib/legalKnowledge.js"),
    import(new URL("../app/lib/helpContent.js", import.meta.url)),
  ]);
  assert.ok(route.includes('import { LEGAL_KNOWLEDGE }'));
  assert.ok(route.includes("APP DOCUMENTATION:"));
  assert.ok(route.includes("LEGAL AND PRIVACY DOCUMENTATION:"));
  assert.ok(route.includes("${HELP_KNOWLEDGE}"));
  assert.ok(route.includes("${LEGAL_KNOWLEDGE}"));
  assert.ok(legal.includes('renderPolicy("Terms of Use"'));
  assert.ok(legal.includes('renderPolicy("Privacy Policy"'));
  assert.ok(legal.includes("$24.99"));
  assert.ok(legal.includes("does not sell"));
  for (const title of ["Contacted You", "Lead risk levels", "Plans and accepted leads", "Payment and plan changes", "Data, account, and help"]) {
    assert.ok(HELP_SECTIONS.some((section) => section.title === title));
  }
});

test("forms and normal screens use direct copy instead of persistent explainers", async () => {
  const [personalization, feedback, rewards, settings, supportChat] = await Promise.all([
    source("app/setup/personalization/page.js"),
    source("app/feedback/page.js"),
    source("app/rewards/page.js"),
    source("app/components/SettingsPanel.js"),
    source("app/components/HelpCenter.js"),
  ]);
  assert.equal(personalization.includes("Choose email, text message, or both for new leads"), false);
  assert.equal(feedback.includes("Tell us honestly what is working"), false);
  assert.equal(rewards.includes("Share honest feedback, refer other businesses"), false);
  assert.equal(settings.includes("Choose where ARK sends new-lead"), false);
  assert.ok(supportChat.includes("App help · clears after 24 hours"));
});
