import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { readAccountSections } from "./accountSections.js";
import { normalizeNotificationPreferences } from "./notificationPreferences.js";
import { sendTelnyxSystemText } from "./telnyxSystemText.js";

function text(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function appUrl(route = "/") {
  const origin = text(process.env.NEXT_PUBLIC_APP_URL || "https://www.arkclientcenter.com").replace(/\/$/, "");
  const path = text(route).startsWith("/") ? text(route) : `/${text(route)}`;
  return `${origin}${path}`;
}

function deliveryDocumentId(eventId, type) {
  return `external-${createHash("sha256")
    .update(`${text(type)}:${text(eventId) || Date.now()}`)
    .digest("hex")
    .slice(0, 40)}`;
}

async function sendNotificationEmail({ to, title, body, route }) {
  const apiKey = text(process.env.RESEND_API_KEY);
  const from = text(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) return { ok: false, status: "provider-not-configured", error: "Email notifications are not configured." };
  const url = appUrl(route);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `ARK Client Center · ${text(title)}`,
        text: `${text(title)}\n\n${text(body)}\n\nOpen ARK Client Center: ${url}`,
        html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(url)}">Open ARK Client Center</a></p>`,
      }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.ok ? "sent" : "provider-error",
      providerMessageId: text(result.id),
      httpStatus: response.status,
      error: response.ok ? "" : text(result?.message || result?.name || `Resend delivery failed (${response.status}).`),
    };
  } catch (error) {
    return { ok: false, status: "provider-error", providerMessageId: "", error: text(error?.message || "Email delivery failed.") };
  }
}

async function saveDelivery({ db, clientId, eventId, type, route, channels }) {
  const sent = channels.filter((channel) => channel.ok).length;
  const failed = channels.length - sent;
  await db.collection("accounts").doc(clientId).collection("notificationDeliveries")
    .doc(deliveryDocumentId(eventId, type))
    .set({
      type: text(type),
      eventId: text(eventId),
      route: text(route),
      deliveryKind: "owner-preference",
      status: channels.length === 0 ? "not-selected" : failed === 0 ? "sent" : sent > 0 ? "partially-sent" : "failed",
      attempted: channels.length,
      sent,
      failed,
      channels: Object.fromEntries(channels.map((channel) => [channel.channel, {
        status: channel.status,
        providerMessageId: text(channel.providerMessageId),
        error: text(channel.error).slice(0, 500),
      }])),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}

export async function sendPreferredAccountNotification({ db, clientId, notification, type, route = "/", eventId = "" }) {
  const safeClientId = text(clientId);
  const title = text(notification?.title);
  const body = text(notification?.body);
  if (!safeClientId || !title || !body) return { attempted: 0, sent: 0, failed: 0, channels: [] };

  const accountSnapshot = await db.collection("accounts").doc(safeClientId).get();
  if (!accountSnapshot.exists) return { attempted: 0, sent: 0, failed: 0, channels: [] };
  const sections = await readAccountSections(accountSnapshot);
  const preferences = normalizeNotificationPreferences(sections?.customization, sections?.account);
  if (preferences.notificationPreferencesCompleted !== true || !preferences.notificationChannels.length) {
    return { attempted: 0, sent: 0, failed: 0, channels: [] };
  }

  const deliveries = preferences.notificationChannels.map(async (channel) => {
    if (channel === "email") {
      return { channel, ...await sendNotificationEmail({ to: preferences.notificationEmail, title, body, route }) };
    }
    const url = appUrl(route);
    const delivery = await sendTelnyxSystemText({
      to: preferences.notificationPhone,
      message: `ARK: ${title}. ${body} ${url}`,
    });
    return { channel, ...delivery };
  });
  const settled = await Promise.all(deliveries);
  await saveDelivery({ db, clientId: safeClientId, eventId, type, route, channels: settled }).catch((error) => {
    console.error("Unable to record owner notification delivery", error);
  });
  return {
    attempted: settled.length,
    sent: settled.filter((delivery) => delivery.ok).length,
    failed: settled.filter((delivery) => !delivery.ok).length,
    channels: settled.map((delivery) => ({ channel: delivery.channel, status: delivery.status, ok: delivery.ok })),
  };
}
