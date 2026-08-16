import { FieldValue } from "firebase-admin/firestore";
import { MESSAGES_AVAILABLE } from "./launchFeatures";

function text(value) {
  return String(value || "").trim();
}

export function normalizeStatusPhone(value) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

async function receptionistPhone(db, clientId) {
  const accountSnapshot = await db.collection("accounts").doc(clientId).get();
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  return normalizeStatusPhone(
    account.receptionistPhoneNormalized || account.receptionistPhone,
  );
}

async function sendText({ from, to, message }) {
  const apiKey = text(process.env.TELNYX_API_KEY);
  if (!apiKey || !from) {
    return {
      ok: false,
      status: "provider-not-configured",
      providerMessageId: "",
      error: "The business messaging number is not configured.",
    };
  }

  try {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, text: message }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    const providerMessageId = text(result?.data?.id || result?.id);
    const firstError = Array.isArray(result?.errors)
      ? result.errors[0]
      : Array.isArray(result?.data?.errors)
        ? result.data.errors[0]
        : null;
    const error = text(firstError?.detail || firstError?.title || result?.error);
    return {
      ok: response.ok,
      status: response.ok ? "sent" : "provider-error",
      providerMessageId,
      error,
    };
  } catch (error) {
    return {
      ok: false,
      status: "provider-error",
      providerMessageId: "",
      error: text(error.message),
    };
  }
}

export function estimateRequestStatusMessage(status, businessName) {
  const brand = text(businessName) || "the business";
  const statusLine = status === "accepted"
    ? `Your estimate request has been accepted by ${brand}.`
    : `We're sorry, but your estimate request has been declined by ${brand}.`;
  return `${statusLine} If you text this number, the business will not be able to see your message until they start a text conversation with you.`;
}

export async function sendEstimateRequestStatusNotice({
  db,
  clientId,
  businessName,
  leadId,
  leadName,
  phone,
  status,
}) {
  if (!MESSAGES_AVAILABLE) return { ok: true, skipped: "feature-unavailable", sent: false };
  const normalizedPhone = normalizeStatusPhone(phone);
  const normalizedStatus = status === "accepted" ? "accepted" : "declined";
  if (!normalizedPhone) return { ok: true, skipped: "missing-phone", sent: false };

  const root = db.collection("accounts").doc(clientId);
  const collectionName = normalizedStatus === "accepted" ? "clientAcceptNotices" : "clientDeclineNotices";
  const noticeRef = root.collection(collectionName).doc(leadId);
  const reserved = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(noticeRef);
    if (existing.exists && ["sending", "sent"].includes(text(existing.data().status))) return false;
    transaction.set(noticeRef, {
      leadId,
      leadName: text(leadName) || null,
      phone: normalizedPhone,
      requestStatus: normalizedStatus,
      status: "sending",
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing.exists
        ? existing.data().createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });

  if (!reserved) return { ok: true, duplicate: true, sent: false };

  const from = await receptionistPhone(db, clientId);
  const message = estimateRequestStatusMessage(normalizedStatus, businessName);
  const delivery = await sendText({ from, to: normalizedPhone, message });
  await noticeRef.set({
    status: delivery.ok ? "sent" : "failed",
    message,
    fromPhone: from || null,
    providerMessageId: delivery.providerMessageId || null,
    providerError: delivery.error || null,
    sentAt: delivery.ok ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    sent: delivery.ok,
    status: delivery.status,
    error: delivery.ok ? null : delivery.error || null,
  };
}
