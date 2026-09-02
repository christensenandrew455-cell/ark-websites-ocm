import { FieldValue } from "firebase-admin/firestore";
import { normalizeTelnyxPhone, sendTelnyxSystemText } from "./telnyxSystemText.js";

function text(value) {
  return String(value || "").trim();
}

export function normalizeStatusPhone(value) {
  return normalizeTelnyxPhone(value);
}

export function estimateRequestStatusMessage(status, businessName) {
  const brand = text(businessName) || "the business";
  const statusLine = status === "accepted"
    ? `Your service request has been accepted by ${brand}. The business owner will follow up to confirm the exact date and time.`
    : `We're sorry, but your service request has been declined by ${brand}.`;
  return statusLine;
}

export function estimateRequestStatusNoticesEnabled(account = {}) {
  if (Object.hasOwn(account, "clientStatusNoticeEnabled")) return account.clientStatusNoticeEnabled !== false;
  return account.clientDeclineNoticeEnabled !== false;
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

  const message = estimateRequestStatusMessage(normalizedStatus, businessName);
  const delivery = await sendTelnyxSystemText({ to: normalizedPhone, message });
  await noticeRef.set({
    status: delivery.ok ? "sent" : "failed",
    message,
    fromPhone: delivery.fromPhone || null,
    providerMessageId: delivery.providerMessageId || null,
    providerErrorCode: delivery.providerErrorCode || null,
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
