import { createHash } from "node:crypto";

function text(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function eventData(body) {
  return body?.data && typeof body.data === "object" ? body.data : body || {};
}

function eventPayload(body) {
  const data = eventData(body);
  return data?.payload && typeof data.payload === "object"
    ? data.payload
    : body?.payload && typeof body.payload === "object"
      ? body.payload
      : {};
}

function eventTime(body, now) {
  const data = eventData(body);
  const payload = eventPayload(body);
  const candidate = text(data.occurred_at || payload.occurred_at || body?.occurred_at, 80);
  const parsed = Date.parse(candidate);
  return new Date(Number.isFinite(parsed) ? parsed : now).toISOString();
}

export function incomingReceptionistCallEvent({ body, clientId, now = Date.now() }) {
  const data = eventData(body);
  const payload = eventPayload(body);
  const eventType = text(data.event_type || body?.event_type, 80).toLowerCase();
  const direction = text(payload.direction, 40).toLowerCase();
  if (eventType !== "call.initiated" || (direction && !["incoming", "inbound"].includes(direction))) return null;

  const safeClientId = text(clientId, 160);
  if (!safeClientId) return null;

  const providerCallId = text(
    payload.call_session_id || payload.call_leg_id || payload.call_control_id || data.id || body?.id,
    500,
  );
  const stableCallKey = providerCallId || JSON.stringify(body || {});
  const callHash = createHash("sha256").update(`${safeClientId}:${stableCallKey}`).digest("hex");

  return {
    id: `receptionist-call-started-${callHash}`,
    type: "receptionist.call.started",
    clientId: safeClientId,
    businessName: "",
    summary: "Call received",
    metadata: {},
    occurredAt: eventTime(body, now),
  };
}
