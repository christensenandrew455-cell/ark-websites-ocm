import { createHmac, randomUUID } from "node:crypto";

function text(value, maximum = 700) {
  return String(value || "").trim().slice(0, maximum);
}

export function signedAdminEvent({ secret, timestamp, body }) {
  return `v1=${createHmac("sha256", text(secret)).update(`${timestamp}.${body}`).digest("hex")}`;
}

export async function sendAdminEvent(event) {
  const url = text(process.env.ARC_ADMIN_WEBHOOK_URL, 2000);
  const secret = text(process.env.ARC_WEBHOOK_SECRET, 1000);
  if (!url || secret.length < 32) return { delivered: false, skipped: true };

  const payload = JSON.stringify({
    id: text(event.id, 160) || randomUUID(),
    type: text(event.type, 80),
    clientId: text(event.clientId, 160),
    businessName: text(event.businessName, 180),
    summary: text(event.summary, 700),
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
    occurredAt: event.occurredAt || new Date().toISOString(),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Arc-Timestamp": timestamp,
        "X-Arc-Signature": signedAdminEvent({ secret, timestamp, body: payload }),
      },
      body: payload,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { delivered: true };
  } catch (error) {
    console.warn("Arc Admin event delivery failed", event.type, error?.message || error);
    return { delivered: false };
  } finally {
    clearTimeout(timeout);
  }
}
