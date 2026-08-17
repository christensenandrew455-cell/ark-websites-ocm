import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOP_LEVEL_COLLECTIONS } from "../app/lib/firestoreLayout.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const appRoot = join(root, "app");

async function applicationSource() {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if ([".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
    }
  }
  await walk(appRoot);
  return (await Promise.all(files.map((path) => readFile(path, "utf8")))).join("\n");
}

test("Firestore exposes exactly three canonical top-level collections", () => {
  assert.deepEqual(Object.values(TOP_LEVEL_COLLECTIONS).sort(), ["accounts", "pendingOwnerSignups", "system"].sort());
});

test("application source contains no retired Firestore collection names", async () => {
  const source = await applicationSource();
  for (const retired of [
    "businesses",
    "ocmClients",
    "connections",
    "businessNameRegistry",
    "accountPhoneRegistry",
    "connectionPhoneRegistry",
    "accountVerificationChallenges",
  ]) assert.equal(source.includes(`collection(\"${retired}\")`), false, `${retired} must stay retired`);
});

test("literal server-side top-level collection calls use only accounts", async () => {
  const source = await applicationSource();
  const names = [...source.matchAll(/\b(?:db|getAdminDb\(\))\.collection\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  assert.deepEqual([...new Set(names)], ["accounts"]);
});

test("browser Firestore paths start only at accounts", async () => {
  const source = await applicationSource();
  const names = [
    ...source.matchAll(/\bcollection\(db,\s*"([^"]+)"/g),
    ...source.matchAll(/\bdoc\(db,\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(names.length > 0);
  assert.deepEqual([...new Set(names)], ["accounts"]);
});

test("account settings live on the account document instead of a settings subcollection", async () => {
  const source = await applicationSource();
  assert.equal(source.includes('.collection("settings")'), false);
  assert.equal(/(?:collection|doc)\(db,\s*"accounts"[^\n]*"settings"/.test(source), false);
});

test("temporary signup is one flat document with an exact one-hour lifetime", async () => {
  const [pending, availability] = await Promise.all([
    readFile(join(root, "app/lib/pendingOwnerSignup.js"), "utf8"),
    readFile(join(root, "app/lib/signupAvailability.js"), "utf8"),
  ]);
  assert.ok(pending.includes("PENDING_OWNER_SIGNUP_TTL_MS = 60 * 60 * 1000"));
  assert.ok(pending.includes("transaction.create(pendingRef, data)"));
  assert.equal(pending.includes('.collection("'), false);
  assert.ok(pending.includes('.where("expiresAt", "<=", now)'));
  assert.ok(availability.includes("pendingOwnerSignupExpired(data)"));
  assert.ok(availability.includes("deletePendingOwnerSignup({"));
});

test("verification secrets are nested privately under the canonical account", async () => {
  const [layout, verification] = await Promise.all([
    readFile(join(root, "app/lib/firestoreLayout.js"), "utf8"),
    readFile(join(root, "app/lib/accountVerification.js"), "utf8"),
  ]);
  assert.ok(layout.includes('.collection("private").doc(text(documentId))'));
  assert.ok(verification.includes('accountPrivateRef(db, clientId, "verification")'));
});

test("Firestore rules name only the three canonical roots", async () => {
  const rules = await readFile(join(root, "firestore.rules"), "utf8");
  const roots = [...rules.matchAll(/^\s*match \/([A-Za-z][A-Za-z0-9]*)\//gm)]
    .map((match) => match[1])
    .filter((name) => name !== "databases");
  assert.deepEqual(roots, ["accounts", "pendingOwnerSignups", "system"]);
  assert.ok(rules.includes('request.auth.token.role == "standard"'));
  assert.equal(rules.includes('request.auth.token.role == "admin"'), false);
  assert.ok(rules.includes("allow get: if isOwner(clientId)"));
  assert.ok(rules.includes('collectionId != "private"'));
});
