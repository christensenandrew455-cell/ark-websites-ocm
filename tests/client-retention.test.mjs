import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanupExpiredClients,
  CLIENT_RETENTION_OPTIONS,
  DEFAULT_CLIENT_RETENTION_DAYS,
  isClientPastRetention,
  normalizeClientRetentionDays,
} from "../app/lib/clientRetention.js";
import { cleanupExpiredLeads } from "../app/lib/leadRetention.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const DAY_MS = 24 * 60 * 60 * 1000;

class MemorySnapshot {
  constructor(reference, value) { this.ref = reference; this.id = reference.id; this.exists = value !== undefined; this.value = value; }
  data() { return this.value; }
}
class MemoryDocumentReference {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new MemoryCollectionReference(this.db, `${this.path}/${name}`); }
  get() { return Promise.resolve(new MemorySnapshot(this, this.db.documents.get(this.path))); }
  set(value) { this.db.documents.set(this.path, { ...value }); return Promise.resolve(); }
  delete() { this.db.documents.delete(this.path); return Promise.resolve(); }
}
class MemoryCollectionReference {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new MemoryDocumentReference(this.db, `${this.path}/${id}`); }
  get() {
    const prefix = `${this.path}/`;
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => new MemorySnapshot(new MemoryDocumentReference(this.db, path), value));
    return Promise.resolve({ docs, empty: docs.length === 0, size: docs.length });
  }
}
class MemoryFirestore {
  constructor() { this.documents = new Map(); }
  collection(name) { return new MemoryCollectionReference(this, name); }
}

test("lead and client retention remain independent account settings", async () => {
  const now = Date.UTC(2026, 7, 17, 12);
  const old = new Date(now - 7 * DAY_MS);
  const recent = new Date(now - 7 * DAY_MS + 1);
  const db = new MemoryFirestore();
  const account = db.collection("accounts").doc("account-one");
  await account.collection("contactedMe").doc("old-lead").set({ updatedAt: old });
  await account.collection("contactedMe").doc("recent-lead").set({ updatedAt: recent });
  await account.collection("clients").doc("old-client").set({ updatedAt: old });
  await account.collection("clients").doc("recent-client").set({ updatedAt: recent });

  assert.equal(await cleanupExpiredLeads(db, "account-one", 7, now), 1);
  assert.equal((await account.collection("clients").doc("old-client").get()).exists, true);
  assert.equal(await cleanupExpiredClients(db, "account-one", 7, now), 1);
  assert.equal((await account.collection("contactedMe").doc("recent-lead").get()).exists, true);
  assert.equal((await account.collection("clients").doc("recent-client").get()).exists, true);
});

test("client retention follows the lead retention options and exact boundary", () => {
  const now = Date.UTC(2026, 7, 17, 12);
  assert.deepEqual(CLIENT_RETENTION_OPTIONS, [0, 1, 7, 30]);
  assert.equal(DEFAULT_CLIENT_RETENTION_DAYS, 0);
  assert.equal(normalizeClientRetentionDays("7"), 7);
  assert.equal(normalizeClientRetentionDays(14), 0);
  assert.equal(isClientPastRetention(now - 7 * DAY_MS + 1, 7, now), false);
  assert.equal(isClientPastRetention(now - 7 * DAY_MS, 7, now), true);
});

test("client retention API and workflow use the clients collection and client setting", async () => {
  const [route, workflow, leads] = await Promise.all([
    source("app/api/business/clients/retention/route.js"),
    source("app/api/cron/workflow/route.js"),
    source("app/lib/leadRetention.js"),
  ]);
  assert.ok(route.includes("clientRetentionDays"));
  assert.ok(route.includes("cleanupExpiredClients"));
  assert.ok(workflow.includes("normalizeClientRetentionDays(business.clientRetentionDays)"));
  assert.ok(workflow.includes("retainedClientsDeleted"));
  assert.equal(leads.includes('collection("clients")'), false);
});
