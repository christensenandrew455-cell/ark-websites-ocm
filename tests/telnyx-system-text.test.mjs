import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  estimateRequestStatusMessage,
  sendEstimateRequestStatusNotice,
} from "../app/lib/estimateRequestStatusNotice.js";
import { sendTelnyxSystemText } from "../app/lib/telnyxSystemText.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

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
    const value = this.db.documents.get(this.path);
    return Promise.resolve({
      exists: value !== undefined,
      data: () => value,
      ref: this,
      id: this.id,
    });
  }

  set(value, options = {}) {
    const current = this.db.documents.get(this.path) || {};
    this.db.documents.set(this.path, options.merge ? { ...current, ...value } : value);
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
}

class MemoryDb {
  constructor() {
    this.documents = new Map();
  }

  collection(name) {
    return new MemoryCollectionReference(this, name);
  }

  runTransaction(callback) {
    return callback({
      get: (reference) => reference.get(),
      set: (reference, value, options) => reference.set(value, options),
    });
  }
}

test("system texts use the same configured sender as account verification", { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.TELNYX_API_KEY;
  const originalFrom = process.env.TELNYX_SIGNUP_FROM_NUMBER;
  let request = null;
  process.env.TELNYX_API_KEY = "test-key";
  process.env.TELNYX_SIGNUP_FROM_NUMBER = "+17745550123";
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: { id: "message-123" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await sendTelnyxSystemText({
      to: "(508) 555-0199",
      message: "Your lead was accepted.",
    });
    const payload = JSON.parse(request.options.body);
    assert.equal(request.url, "https://api.telnyx.com/v2/messages");
    assert.equal(payload.from, "+17745550123");
    assert.equal(payload.to, "+15085550199");
    assert.equal(result.ok, true);
    assert.equal(result.providerMessageId, "message-123");
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.TELNYX_SIGNUP_FROM_NUMBER;
    else process.env.TELNYX_SIGNUP_FROM_NUMBER = originalFrom;
  }
});

test("lead messages cover acceptance and decline", () => {
  assert.equal(
    estimateRequestStatusMessage("accepted", "Tabor Painting"),
    "Your estimate request has been accepted by Tabor Painting.",
  );
  assert.equal(
    estimateRequestStatusMessage("declined", "Tabor Painting"),
    "We're sorry, but your estimate request has been declined by Tabor Painting.",
  );
});

test("acceptance and decline deliveries are idempotently recorded", { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.TELNYX_API_KEY;
  const originalFrom = process.env.TELNYX_SIGNUP_FROM_NUMBER;
  const db = new MemoryDb();
  const payloads = [];
  process.env.TELNYX_API_KEY = "test-key";
  process.env.TELNYX_SIGNUP_FROM_NUMBER = "+17745550123";
  global.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ data: { id: `message-${payloads.length}` } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const common = {
      db,
      clientId: "tabor-painting",
      businessName: "Tabor Painting",
      leadName: "Jordan Smith",
      phone: "+15085550199",
    };
    const accepted = await sendEstimateRequestStatusNotice({ ...common, leadId: "lead-1", status: "accepted" });
    const duplicateAccepted = await sendEstimateRequestStatusNotice({ ...common, leadId: "lead-1", status: "accepted" });
    const declined = await sendEstimateRequestStatusNotice({ ...common, leadId: "lead-2", status: "declined" });

    assert.equal(accepted.sent, true);
    assert.equal(duplicateAccepted.duplicate, true);
    assert.equal(declined.sent, true);
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads.map((payload) => payload.from), [
      "+17745550123",
      "+17745550123",
    ]);
    assert.equal(
      db.documents.get("accounts/tabor-painting/clientAcceptNotices/lead-1").status,
      "sent",
    );
    assert.equal(
      db.documents.get("accounts/tabor-painting/clientDeclineNotices/lead-2").status,
      "sent",
    );
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.TELNYX_SIGNUP_FROM_NUMBER;
    else process.env.TELNYX_SIGNUP_FROM_NUMBER = originalFrom;
  }
});

test("lead intake never sends a customer text before an owner decision", async () => {
  const intakeRoute = await source("app/api/intake/route.js");
  assert.equal(intakeRoute.includes("sendTelnyxSystemText"), false);
  assert.equal(intakeRoute.includes("sendEstimateRequestStatusNotice"), false);
  assert.equal(intakeRoute.includes("confirmationText"), false);
});

test("lead status texts are independent from unreleased chat messaging", async () => {
  const [component, statusNotice, verification] = await Promise.all([
    source("app/components/ReviewClientsNative.js"),
    source("app/lib/estimateRequestStatusNotice.js"),
    source("app/lib/accountVerification.js"),
  ]);
  assert.ok(component.includes('if (row.collectionKey === "contactedMe")'));
  assert.equal(component.includes('if (MESSAGES_AVAILABLE && row.collectionKey === "contactedMe")'), false);
  assert.ok(statusNotice.includes("sendTelnyxSystemText"));
  assert.equal(statusNotice.includes("receptionistPhone"), false);
  assert.ok(verification.includes('import { sendTelnyxSystemText } from "./telnyxSystemText.js"'));
});

test("Google address validation stays in the receptionist instead of OCM", async () => {
  const files = await Promise.all([
    source("app/api/intake/route.js"),
    source("app/lib/leadRiskAssessment.js"),
    source("app/lib/estimateRequestStatusNotice.js"),
  ]);
  const ocmSource = files.join("\n");
  assert.equal(ocmSource.includes("GOOGLE_MAPS_API_KEY"), false);
  assert.equal(ocmSource.includes("addressvalidation.googleapis.com"), false);
});
