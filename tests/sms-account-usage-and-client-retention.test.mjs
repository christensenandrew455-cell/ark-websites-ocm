import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  ACCEPTED_LEAD_BILLING_SOURCE,
  acceptedLeadBillingSourceId,
  billingLeadEventRef,
} from "../app/lib/billingLeadUsage.js";
import { billingMessageEventRef } from "../app/lib/billingMessageUsage.js";
import {
  cleanupExpiredClients,
  CLIENT_RETENTION_OPTIONS,
  DEFAULT_CLIENT_RETENTION_DAYS,
  isClientPastRetention,
  normalizeClientRetentionDays,
} from "../app/lib/clientRetention.js";
import { cleanupExpiredLeads } from "../app/lib/leadRetention.js";
import {
  reconcileNonAcceptedLeadUsage,
  recordLeadUsage,
  recordSmsPartUsage,
  recordUsage,
  usageEventDocumentId,
} from "../app/lib/usageThresholdBilling.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const DAY_MS = 24 * 60 * 60 * 1000;

class MemorySnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.id = reference.id;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return this.value;
  }
}

class MemoryDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  collection(name) {
    return new MemoryCollectionReference(this.db, `${this.path}/${name}`);
  }

  get() {
    return Promise.resolve(this.db.snapshot(this));
  }

  set(value, options) {
    this.db.set(this, value, options);
    return Promise.resolve();
  }

  delete() {
    this.db.documents.delete(this.path);
    return Promise.resolve();
  }
}

class MemoryCollectionReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  doc(id) {
    return new MemoryDocumentReference(this.db, `${this.path}/${id}`);
  }

  get() {
    const prefix = `${this.path}/`;
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => new MemorySnapshot(new MemoryDocumentReference(this.db, path), value));
    return Promise.resolve({ docs, empty: docs.length === 0, size: docs.length });
  }

  where(field, operator, value) {
    if (operator !== "==") throw new Error(`Unsupported memory query operator: ${operator}`);
    return new MemoryQuery(this.db, this.path, [{ field, value }]);
  }
}

class MemoryQuery {
  constructor(db, path, filters, maximum = Infinity) {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.maximum = maximum;
  }

  where(field, operator, value) {
    if (operator !== "==") throw new Error(`Unsupported memory query operator: ${operator}`);
    return new MemoryQuery(this.db, this.path, [...this.filters, { field, value }], this.maximum);
  }

  limit(maximum) {
    return new MemoryQuery(this.db, this.path, this.filters, maximum);
  }

  async get() {
    const snapshot = await new MemoryCollectionReference(this.db, this.path).get();
    const docs = snapshot.docs
      .filter((document) => this.filters.every(({ field, value }) => document.data()?.[field] === value))
      .slice(0, this.maximum);
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class MemoryFirestore {
  constructor() {
    this.documents = new Map();
    this.transactionTail = Promise.resolve();
  }

  collection(name) {
    return new MemoryCollectionReference(this, name);
  }

  snapshot(reference) {
    return new MemorySnapshot(reference, this.documents.get(reference.path));
  }

  set(reference, value, options = {}) {
    const current = this.documents.get(reference.path) || {};
    this.documents.set(reference.path, options.merge ? { ...current, ...value } : { ...value });
  }

  runTransaction(action) {
    const result = this.transactionTail.then(() => action({
      get: (reference) => Promise.resolve(this.snapshot(reference)),
      create: (reference, value) => {
        if (this.documents.has(reference.path)) throw new Error("already-exists");
        this.set(reference, value);
      },
      set: (reference, value, options) => this.set(reference, value, options),
    }));
    this.transactionTail = result.catch(() => undefined);
    return result;
  }
}

async function accountData(db, clientId = "account-one") {
  return (await db.collection("accounts").doc(clientId).get()).data();
}

async function recordMessageParts(db, { clientId = "account-one", sourceId, smsParts }) {
  const ledgerRef = billingMessageEventRef(db, {
    clientId,
    direction: "outbound",
    sourceId,
  });
  await ledgerRef.set({ smsParts, usageRecorded: false });
  return recordSmsPartUsage({
    db,
    clientId,
    sourceId: ledgerRef.id,
    smsParts,
    ledgerRef,
    occurredAt: Date.UTC(2026, 7, 17),
  });
}

test("SMS parts from separate chats share one atomic account bucket", async () => {
  const db = new MemoryFirestore();
  await db.collection("accounts").doc("account-one").set({
    uid: "owner-one",
    status: "active",
    usageBalancePoints: 0,
    usageSmsPartRemainder: 0,
    usageChargeStatus: "idle",
  });

  await Promise.all(Array.from({ length: 5 }, (_, index) => recordMessageParts(db, {
    sourceId: `chat-${index + 1}:message-1`,
    smsParts: 1,
  })));

  assert.equal((await accountData(db)).usageSmsPartRemainder, 5);
  assert.equal((await accountData(db)).usageBalancePoints, 0);

  const threshold = await recordMessageParts(db, {
    sourceId: "chat-6:message-1",
    smsParts: 45,
  });
  assert.equal(threshold.smsPoints, 1);
  assert.equal((await accountData(db)).usageSmsPartRemainder, 0);
  assert.equal((await accountData(db)).usageBalancePoints, 1);
});

test("retrying the same SMS event cannot add its parts twice", async () => {
  const db = new MemoryFirestore();
  await db.collection("accounts").doc("account-one").set({
    uid: "owner-one",
    status: "active",
    usageBalancePoints: 0,
    usageSmsPartRemainder: 0,
    usageChargeStatus: "idle",
  });

  const first = await recordMessageParts(db, { sourceId: "chat-1:provider-message-1", smsParts: 3 });
  const duplicate = await recordMessageParts(db, { sourceId: "chat-1:provider-message-1", smsParts: 3 });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await accountData(db)).usageSmsPartRemainder, 3);
});

test("four legacy call or intake charges are removed while an accepted lead remains billable", async () => {
  const db = new MemoryFirestore();
  const clientId = "account-one";
  const account = db.collection("accounts").doc(clientId);
  await account.set({
    uid: "owner-one",
    status: "active",
    usageBalancePoints: 10,
    usageSmsPartRemainder: 0,
    usageChargeStatus: "idle",
  });

  const invalidEventIds = [];
  for (const sourceId of ["call-1", "call-2", "call-3", "submitted-intake-1"]) {
    const id = usageEventDocumentId(clientId, "lead", sourceId);
    invalidEventIds.push(id);
    await account.collection("usageEvents").doc(id).set({ type: "lead", points: 2 });
  }

  const acceptedLedger = billingLeadEventRef(db, {
    clientId,
    sourceId: acceptedLeadBillingSourceId("accepted-lead-1"),
  });
  await acceptedLedger.set({
    leadId: "accepted-lead-1",
    sourceType: ACCEPTED_LEAD_BILLING_SOURCE,
    usageRecorded: true,
  });
  const acceptedUsageEventId = usageEventDocumentId(clientId, "lead", acceptedLedger.id);
  await account.collection("usageEvents").doc(acceptedUsageEventId).set({ type: "lead", points: 2 });

  const correction = await reconcileNonAcceptedLeadUsage({ db, clientId });
  assert.equal(correction.voided, 4);
  assert.equal(correction.pointsVoided, 8);
  assert.equal(correction.balancePointsRemoved, 8);
  assert.equal(correction.balancePoints, 2);
  assert.equal((await accountData(db)).usageBalancePoints, 2);
  for (const id of invalidEventIds) {
    const event = (await account.collection("usageEvents").doc(id).get()).data();
    assert.equal(event.voided, true);
    assert.equal(event.voidReason, "lead-not-accepted");
  }
  assert.notEqual((await account.collection("usageEvents").doc(acceptedUsageEventId).get()).data().voided, true);

  const cachedCorrection = await reconcileNonAcceptedLeadUsage({ db, clientId });
  assert.equal(cachedCorrection.skipped, true);
  assert.equal(cachedCorrection.balancePoints, 2);

  const duplicateCorrection = await reconcileNonAcceptedLeadUsage({ db, clientId, force: true });
  assert.equal(duplicateCorrection.voided, 0);
  assert.equal(duplicateCorrection.balancePointsRemoved, 0);
  assert.equal((await accountData(db)).usageBalancePoints, 2);
});

test("lead usage cannot be recorded without an accepted-lead ledger", async () => {
  const db = new MemoryFirestore();
  const clientId = "account-one";
  await db.collection("accounts").doc(clientId).set({
    uid: "owner-one",
    status: "active",
    usageBalancePoints: 0,
    usageSmsPartRemainder: 0,
    usageChargeStatus: "idle",
  });

  await assert.rejects(
    recordUsage({ db, clientId, type: "lead", sourceId: "call-without-acceptance", points: 2 }),
    /LEAD_ACCEPTANCE_REQUIRED/,
  );
  assert.equal((await accountData(db)).usageBalancePoints, 0);

  const ledgerRef = billingLeadEventRef(db, {
    clientId,
    sourceId: acceptedLeadBillingSourceId("lead-1"),
  });
  await ledgerRef.set({ sourceType: ACCEPTED_LEAD_BILLING_SOURCE, usageRecorded: false });
  const accepted = await recordLeadUsage({ db, clientId, sourceId: ledgerRef.id, ledgerRef });
  assert.equal(accepted.addedPoints, 2);
  assert.equal((await accountData(db)).usageBalancePoints, 2);
});

test("lead and client retention are independent account settings", async () => {
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
