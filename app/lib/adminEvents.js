import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ARK_ADMIN_WEBHOOK_URL = "https://ark-admin-app.vercel.app/api/webhooks/events";

function text(value, maximum = 700) {
  return String(value || "").trim().slice(0, maximum);
}

export function signedAdminEvent({ secret, timestamp, body }) {
  return `v1=${createHmac("sha256", text(secret)).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyAdminEvent({ secret, timestamp, signature, body, now = Date.now() }) {
  const configuredSecret = text(secret, 1000);
  const requestTimestamp = text(timestamp, 20);
  const provided = text(signature, 80).replace(/^v1=/i, "");
  if (configuredSecret.length < 32) return { ok: false, status: 503, error: "The ARK webhook is not configured." };
  if (!/^\d{10}$/.test(requestTimestamp)) return { ok: false, status: 401, error: "The webhook timestamp is invalid." };
  if (Math.abs(Math.floor(now / 1000) - Number(requestTimestamp)) > 5 * 60) return { ok: false, status: 401, error: "The webhook request expired." };
  const expected = signedAdminEvent({ secret: configuredSecret, timestamp: requestTimestamp, body }).replace(/^v1=/, "");
  if (!/^[a-f0-9]{64}$/i.test(provided) || !timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"))) {
    return { ok: false, status: 401, error: "The webhook signature is invalid." };
  }
  return { ok: true };
}

export async function sendAdminEvent(event) {
  const url = text(process.env.ARK_ADMIN_WEBHOOK_URL || process.env.ARC_ADMIN_WEBHOOK_URL || ARK_ADMIN_WEBHOOK_URL, 2000);
  const secret = text(process.env.ARK_WEBHOOK_SECRET || process.env.ARC_WEBHOOK_SECRET, 1000);
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
        "X-ARK-Timestamp": timestamp,
        "X-ARK-Signature": signedAdminEvent({ secret, timestamp, body: payload }),
        // Temporary wire compatibility for the separately deployed admin app.
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
    console.warn("ARK Admin event delivery failed", event.type, error?.message || error);
    return { delivered: false };
  } finally {
    clearTimeout(timeout);
  }
}
