import { FieldValue } from "firebase-admin/firestore";
import { normalizeTelnyxPhone, sendTelnyxSystemText } from "./telnyxSystemText.js";

function text(value) {
  return String(value || "").trim();
}

export function estimateRequestReceivedMessage(businessName) {
  const brand = text(businessName) || "the business";
  return `Your service request was received by ${brand}. They'll review it and follow up with you.`;
}

export async function sendEstimateRequestReceivedNotice({
  db,
  clientId,
  businessName,
  leadId,
  leadName,
  phone,
}) {
  const normalizedPhone = normalizeTelnyxPhone(phone);
  if (!normalizedPhone) return { ok: true, skipped: "missing-phone", sent: false };

  const noticeRef = db.collection("accounts").doc(clientId)
    .collection("serviceRequestReceivedNotices").doc(leadId);
  const reserved = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(noticeRef);
    if (existing.exists && ["sending", "sent"].includes(text(existing.data().status))) return false;
    transaction.set(noticeRef, {
      leadId,
      leadName: text(leadName) || null,
      phone: normalizedPhone,
      status: "sending",
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing.exists
        ? existing.data().createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });

  if (!reserved) return { ok: true, duplicate: true, sent: false };

  const message = estimateRequestReceivedMessage(businessName);
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
