import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { incomingReceptionistCallEvent } from "../app/lib/receptionistCallNotification.js";

const incomingCall = {
  data: {
    event_type: "call.initiated",
    id: "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    occurred_at: "2026-09-04T05:00:00.000Z",
    payload: {
      call_control_id: "v3:call-control",
      call_leg_id: "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      call_session_id: "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      direction: "incoming",
      from: "+15085550123",
      to: "+17742316164",
    },
  },
};

test("incoming receptionist calls create one deterministic ARK Admin event", () => {
  const event = incomingReceptionistCallEvent({
    body: incomingCall,
    clientId: "tabor-painting",
  });
  const retry = incomingReceptionistCallEvent({
    body: incomingCall,
    clientId: "tabor-painting",
  });

  assert.equal(event.type, "receptionist.call.started");
  assert.equal(event.id, retry.id);
  assert.equal(event.summary, "Call received");
  assert.deepEqual(event.metadata, {});
  assert.equal(JSON.stringify(event).includes("+15085550123"), false);
  assert.equal(JSON.stringify(event).includes("+17742316164"), false);
  assert.equal(event.occurredAt, "2026-09-04T05:00:00.000Z");
});

test("outgoing and later Telnyx call events do not create incoming-call alerts", () => {
  assert.equal(incomingReceptionistCallEvent({
    body: { data: { ...incomingCall.data, payload: { ...incomingCall.data.payload, direction: "outgoing" } } },
    clientId: "tabor-painting",
  }), null);
  assert.equal(incomingReceptionistCallEvent({
    body: { data: { ...incomingCall.data, event_type: "call.answered" } },
    clientId: "tabor-painting",
  }), null);
});

test("the receptionist runtime dispatches the call event after responding", async () => {
  const route = await readFile(new URL("../app/api/receptionist/runtime/route.js", import.meta.url), "utf8");
  assert.ok(route.includes("incomingReceptionistCallEvent"));
  assert.ok(route.includes("after(() => sendAdminEvent(incomingCallEvent))"));
});
