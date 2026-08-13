import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { billingPaymentDeadline } from "../app/lib/billingNotice.js";

test("disabled owner dashboard features are real disabled buttons", async () => {
  const source = await readFile(new URL("../app/components/ClientStats.js", import.meta.url), "utf8");
  assert.ok(source.includes("disabled={disabled}"));
  assert.ok(source.includes("onClick={disabled ? undefined : onClick}"));
  assert.ok(source.includes("cursor-not-allowed"));
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

test("payment warnings show a concrete deadline without an update-payment button", async () => {
  const source = await readFile(new URL("../app/components/AppShell.js", import.meta.url), "utf8");
  assert.ok(source.includes("Payment due"));
  assert.ok(source.includes("Payment was due"));
  assert.ok(source.includes("Payment status couldn’t refresh"));
  assert.ok(source.includes("Try again"));
  assert.equal(source.includes("Update Payment"), false);

  assert.equal(billingPaymentDeadline({
    offenseNumber: 1,
    quietEndsAt: "2026-08-13T12:00:00.000Z",
  }), "2026-08-20T12:00:00.000Z");
  assert.equal(billingPaymentDeadline({
    offenseNumber: 2,
    failureAt: "2026-08-12T12:00:00.000Z",
  }), "2026-08-13T12:00:00.000Z");
});
