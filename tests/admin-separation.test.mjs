import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import test from "node:test";
import { signedAdminEvent } from "../app/lib/adminEvents.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

async function hasNoFiles(path) {
  return readdir(new URL(path, root), { recursive: true, withFileTypes: true })
    .then((entries) => entries.every((entry) => !entry.isFile()), () => true);
}

test("ARC Client Center contains no administrator surface or administrator role", async () => {
  const [roles, login, authProvider, shell, receptionistForm, rules] = await Promise.all([
    source("app/lib/accountRoles.js"),
    source("app/api/auth/business-login/route.js"),
    source("app/components/AuthProvider.js"),
    source("app/components/AppShell.js"),
    source("app/components/ReceptionistBusinessForm.js"),
    source("firestore.rules"),
  ]);
  for (const path of ["app/api/admin", "app/connections", "app/payment", "app/notifications", "app/website-requests"]) {
    assert.equal(await hasNoFiles(path), true, `${path} must stay outside the customer repository`);
  }
  for (const content of [roles, login, authProvider, shell, receptionistForm, rules]) {
    assert.equal(/role\s*[=:]{1,3}\s*["']admin["']|isAdmin|ADMIN_EMAILS/.test(content), false);
  }
  assert.equal(receptionistForm.includes("adminMode"), false);
});

test("operational event bridge signs the exact timestamp and JSON body", () => {
  const secret = "a".repeat(64);
  const timestamp = "1786900000";
  const body = JSON.stringify({ id: "event-1", type: "lead.created" });
  const expected = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  assert.equal(signedAdminEvent({ secret, timestamp, body }), expected);
});
