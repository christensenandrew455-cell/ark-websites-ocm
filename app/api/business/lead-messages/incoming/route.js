import { createHash, createPublicKey, verify } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { systemCollection } from "../../../../lib/firestoreLayout";
import { MESSAGES_AVAILABLE } from "../../../../lib/launchFeatures";
import { addBillingMessageEventToTransaction, billingMessageEventRef } from "../../../../lib/billingMessageUsage";
import { isMessageContactBlocked } from "../../../../lib/messageContactBlocks";
import {
  ARK_SUPPORT_URL,
  helpConfirmationMessage,
  messagingKeyword,
  optInKeywordConfirmationMessage,
  optOutConfirmationMessage,
} from "../../../../lib/messagingCompliance";
import { smsPartCount } from "../../../../lib/smsParts";
import { sendInboundMessageNotification } from "../../../../lib/messageNotificationService";
import { recordSmsPartUsage } from "../../../../lib/usageThresholdBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function normalizePhone(value) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}
function conversationId(clientId, collectionKey, leadId) {
  return createHash("sha256").update(`${clientId}:${collectionKey}:${leadId}`).digest("hex").slice(0, 48);
}
function inboundEventId(clientId, providerMessageId) {
  return createHash("sha256").update(`${clientId}:${providerMessageId}`).digest("hex").slice(0, 48);
}
function secretMatches(request) {
  const expected = text(process.env.ARK_MESSAGING_INBOUND_SECRET);
  if (!expected) return false;
  const authorization = text(request.headers.get("authorization"));
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : text(request.headers.get("x-ark-messaging-secret"));
  return Boolean(provided && expected === provided);
}
function telnyxSignatureMatches(request, rawBody) {
  const configuredKey = text(process.env.TELNYX_PUBLIC_KEY);
  const signature = text(request.headers.get("telnyx-signature-ed25519"));
  const timestamp = text(request.headers.get("telnyx-timestamp"));
  if (!configuredKey || !signature || !timestamp) return false;
  try {
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
    const key = configuredKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(configuredKey.replaceAll("\\n", "\n"))
      : createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(configuredKey, "base64")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"));
  } catch (error) {
    console.error("Unable to verify Telnyx webhook signature", error);
    return false;
  }
}
function parsePayload(body) {
  const event = body?.data || body;
  const payload = event?.payload || body?.payload || body;
  const destination = Array.isArray(payload?.to) ? payload.to[0] : payload?.to;
  const to = destination?.phone_number || destination?.number || destination;
  const from = payload?.from?.phone_number || payload?.from?.number || payload?.from;
  const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  return {
    eventType: text(event?.event_type || body?.event_type),
    toPhone: normalizePhone(to || body?.toPhone || body?.recipient),
    fromPhone: normalizePhone(from || body?.fromPhone || body?.sender),
    messageBody: text(payload?.text || payload?.body || body?.message || body?.body).slice(0, 1600),
    providerMessageId: text(payload?.id || body?.providerMessageId || body?.messageId),
    deliveryStatus: text(destination?.status || payload?.status),
    providerErrorCode: text(firstError?.code),
    providerError: text(firstError?.detail || firstError?.title),
    senderName: text(body?.senderName),
    clientId: text(body?.clientId),
    providedConversationId: text(body?.conversationId),
  };
}
async function resolveClientId(db, suppliedClientId, businessPhone) {
  if (suppliedClientId) return suppliedClientId;
  if (!businessPhone) return "";
  const normalizedMatch = await db.collection("accounts").where("receptionistPhoneNormalized", "==", businessPhone).limit(1).get();
  if (!normalizedMatch.empty) return normalizedMatch.docs[0].id;
  const rawMatch = await db.collection("accounts").where("receptionistPhone", "==", businessPhone).limit(1).get();
  return rawMatch.empty ? "" : rawMatch.docs[0].id;
}
async function findOutboundMessage(db, clientId, providerMessageId) {
  const root = db.collection("accounts").doc(clientId);
  const indexRef = root.collection("telnyxMessageIndex").doc(providerMessageId);
  const indexSnapshot = await indexRef.get();
  if (indexSnapshot.exists) {
    const index = indexSnapshot.data();
    const conversationKey = text(index.conversationId);
    const messageId = text(index.messageId);
    if (conversationKey && messageId) return { messageRef: root.collection("leadConversations").doc(conversationKey).collection("messages").doc(messageId), indexRef, conversationKey, messageId };
  }
  const conversations = await root.collection("leadConversations").get();
  for (const conversation of conversations.docs) {
    const match = await conversation.ref.collection("messages").where("providerMessageId", "==", providerMessageId).limit(1).get();
    if (match.empty) continue;
    const message = match.docs[0];
    return { messageRef: message.ref, indexRef, conversationKey: conversation.id, messageId: message.id };
  }
  return null;
}
async function recordDeliveryUpdate(db, event) {
  if (!event.providerMessageId) return { matched: false, reason: "missing-message-id" };
  const clientId = await resolveClientId(db, event.clientId, event.fromPhone);
  if (!clientId) return { matched: false, reason: "business-not-found" };
  const matched = await findOutboundMessage(db, clientId, event.providerMessageId);
  if (!matched) return { matched: false, reason: "message-not-found", clientId };
  const status = event.deliveryStatus || (event.eventType === "message.sent" ? "sent" : "delivery-unconfirmed");
  const patch = { deliveryStatus: status, providerErrorCode: event.providerErrorCode || null, providerError: event.providerError || null, providerEventType: event.eventType, providerUpdatedAt: FieldValue.serverTimestamp() };
  const batch = db.batch();
  batch.set(matched.messageRef, patch, { merge: true });
  batch.set(matched.indexRef, { providerMessageId: event.providerMessageId, conversationId: matched.conversationKey, messageId: matched.messageId, fromPhone: event.fromPhone || null, toPhone: event.toPhone || null, ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { matched: true, clientId, conversationId: matched.conversationKey, messageId: matched.messageId, deliveryStatus: status };
}
async function resolveConversation(db, clientId, fromPhone, suppliedConversationId) {
  const root = db.collection("accounts").doc(clientId);
  if (suppliedConversationId) {
    const ref = root.collection("leadConversations").doc(suppliedConversationId);
    const snapshot = await ref.get();
    if (snapshot.exists) return { ref, snapshot, conversationId: suppliedConversationId, conversation: snapshot.data(), created: false };
  }
  if (fromPhone) {
    const normalizedMatch = await root.collection("leadConversations").where("leadPhoneNormalized", "==", fromPhone).limit(1).get();
    if (!normalizedMatch.empty) {
      const snapshot = normalizedMatch.docs[0];
      return { ref: snapshot.ref, snapshot, conversationId: snapshot.id, conversation: snapshot.data(), created: false };
    }
    const conversations = await root.collection("leadConversations").get();
    const existing = conversations.docs.find((document) => normalizePhone(document.data().leadPhone) === fromPhone);
    if (existing) return { ref: existing.ref, snapshot: existing, conversationId: existing.id, conversation: existing.data(), created: false };
  }
  return null;
}

export async function POST(request) {
  const rawBody = await request.text();
  if (!secretMatches(request) && !telnyxSignatureMatches(request, rawBody)) return NextResponse.json({ error: "Invalid messaging webhook credentials." }, { status: 401 });
  if (!MESSAGES_AVAILABLE) return NextResponse.json({ ok: true, ignored: true, reason: "feature-unavailable" });
  try {
    const body = JSON.parse(rawBody || "{}");
    const event = parsePayload(body);
    const db = getAdminDb();
    if (event.eventType === "message.sent" || event.eventType === "message.finalized") {
      const result = await recordDeliveryUpdate(db, event);
      return NextResponse.json({ ok: true, eventType: event.eventType, providerMessageId: event.providerMessageId, ...result });
    }
    if (event.eventType && event.eventType !== "message.received") return NextResponse.json({ ok: true, ignored: true, eventType: event.eventType });
    if (!event.messageBody || !event.fromPhone) return NextResponse.json({ error: "An inbound phone number and message are required." }, { status: 400 });

    const clientId = await resolveClientId(db, event.clientId, event.toPhone);
    if (!clientId) return NextResponse.json({ error: "No ARK business is assigned to that Telnyx number." }, { status: 404 });
    if (await isMessageContactBlocked(db, clientId, event.fromPhone)) {
      return NextResponse.json({ ok: true, ignored: true, reason: "contact-blocked" });
    }
    const resolved = await resolveConversation(db, clientId, event.fromPhone, event.providedConversationId);
    if (!resolved) return NextResponse.json({ ok: true, ignored: true, reason: "conversation-not-started" });

    const root = db.collection("accounts").doc(clientId);
    const businessSnapshot = await db.collection("accounts").doc(clientId).get();
    const business = businessSnapshot.exists ? businessSnapshot.data() : {};
    if (!businessSnapshot.exists || business.status !== "active" || business.billingPastDue === true) {
      return NextResponse.json({ ok: true, ignored: true, reason: "payment-disabled" });
    }
    if (business.messagesEnabled !== true) return NextResponse.json({ ok: true, ignored: true, reason: "messages-disabled" });
    const businessName = text(business.businessName || business.name) || "the business";
    const keyword = messagingKeyword(event.messageBody);
    const conversation = resolved.conversation;
    const eventKey = event.providerMessageId ? inboundEventId(clientId, event.providerMessageId) : "";
    const inboundIndexRef = eventKey ? root.collection("telnyxInboundMessageIndex").doc(eventKey) : null;
    const messageRef = eventKey ? resolved.ref.collection("messages").doc(`inbound-${eventKey}`) : resolved.ref.collection("messages").doc();
    const parts = smsPartCount(event.messageBody);
    const usageLedgerRef = billingMessageEventRef(db, { clientId, direction: "inbound", sourceId: event.providerMessageId || messageRef.id });
    const messageData = {
      direction: "inbound",
      body: event.messageBody,
      senderName: event.senderName || conversation.leadName || event.fromPhone,
      senderRole: "lead",
      messageType: keyword ? "compliance-keyword" : "conversation",
      complianceKeyword: keyword || null,
      smsParts: parts,
      providerMessageId: event.providerMessageId || null,
      providerFrom: event.fromPhone,
      providerTo: event.toPhone || null,
      deliveryStatus: "received",
      createdAt: FieldValue.serverTimestamp(),
    };

    const compliancePatch = keyword === "stop"
      ? { messagingOptOutPending: false, messagingOptedOut: true, messagingOptedOutAt: FieldValue.serverTimestamp(), lastComplianceKeyword: "STOP" }
      : keyword === "start"
        ? { messagingOptOutPending: false, messagingOptedOut: false, messagingOptedInAt: FieldValue.serverTimestamp(), lastComplianceKeyword: "START" }
        : keyword === "help"
          ? { supportRequestedAt: FieldValue.serverTimestamp(), lastComplianceKeyword: "HELP" }
          : {};

    const conversationUpdate = {
      ...conversation,
      businessPhone: event.toPhone || conversation.businessPhone || null,
      smsParts: FieldValue.increment(parts),
      lastMessage: event.messageBody,
      lastMessageDirection: "inbound",
      lastMessageAt: FieldValue.serverTimestamp(),
      ...compliancePatch,
      updatedAt: FieldValue.serverTimestamp(),
    };

    let complianceEventRef = null;
    let complianceEventData = null;
    if (keyword) {
      complianceEventRef = eventKey
        ? systemCollection(db, "messagingComplianceEvents").doc(eventKey)
        : systemCollection(db, "messagingComplianceEvents").doc();
      const expectedResponse = keyword === "stop"
        ? optOutConfirmationMessage(businessName)
        : keyword === "start"
          ? optInKeywordConfirmationMessage(businessName)
          : keyword === "help"
              ? helpConfirmationMessage()
              : "";
      complianceEventData = {
        clientId,
        businessName,
        conversationId: resolved.conversationId,
        leadId: conversation.leadId || null,
        leadName: conversation.leadName || null,
        reporterPhone: event.fromPhone,
        businessPhone: event.toPhone || null,
        keyword,
        originalMessage: event.messageBody,
        expectedTelnyxAutoResponse: expectedResponse,
        supportUrl: keyword === "help" ? ARK_SUPPORT_URL : null,
        status: keyword === "help" ? "open" : keyword === "stop" ? "opted-out" : "recorded",
        source: "telnyx-keyword",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
    }

    const duplicate = await db.runTransaction(async (transaction) => {
      const [latestConversation, existingEvent] = await Promise.all([
        transaction.get(resolved.ref),
        inboundIndexRef ? transaction.get(inboundIndexRef) : Promise.resolve(null),
      ]);
      if (existingEvent?.exists) return true;
      const latestData = latestConversation.exists ? latestConversation.data() : {};
      transaction.set(messageRef, messageData);
      addBillingMessageEventToTransaction(transaction, db, {
        clientId,
        direction: "inbound",
        sourceId: event.providerMessageId || messageRef.id,
        sourceType: keyword ? "compliance-keyword" : "conversation",
        smsParts: parts,
      });
      transaction.set(resolved.ref, {
        ...conversationUpdate,
        ...(!keyword ? { ownerUnreadCount: Number(latestData.ownerUnreadCount || 0) + 1 } : {}),
        ...(!latestConversation.exists ? {
          createdAt: FieldValue.serverTimestamp(),
          ownerUnreadCount: keyword ? 0 : 1,
        } : {}),
      }, { merge: true });
      if (complianceEventRef && complianceEventData) transaction.set(complianceEventRef, complianceEventData);
      if (inboundIndexRef) {
        transaction.set(inboundIndexRef, {
          providerMessageId: event.providerMessageId,
          conversationId: resolved.conversationId,
          messageId: messageRef.id,
          receivedAt: FieldValue.serverTimestamp(),
        });
      }
      return false;
    });
    if (duplicate) {
      await recordSmsPartUsage({ db, clientId, sourceId: usageLedgerRef.id, smsParts: parts, ledgerRef: usageLedgerRef }).catch((usageError) => {
        if (text(usageError?.message) !== "ACCOUNT_USAGE_SUSPENDED") console.error("Unable to finish duplicate inbound usage accounting", usageError);
      });
      return NextResponse.json({ ok: true, duplicate: true, clientId, conversationId: resolved.conversationId, messageId: messageRef.id, keyword: keyword || null });
    }
    let usagePayment = null;
    try {
      usagePayment = (await recordSmsPartUsage({ db, clientId, sourceId: usageLedgerRef.id, smsParts: parts, ledgerRef: usageLedgerRef })).payment || null;
    } catch (usageError) {
      if (text(usageError?.message) !== "ACCOUNT_USAGE_SUSPENDED") console.error("Inbound message saved but usage accounting needs a retry", usageError);
    }
    let notification = { attempted: 0, sent: 0, failed: 0 };
    if (!keyword && usagePayment?.status !== "declined") {
      try {
        notification = await sendInboundMessageNotification({ db, clientId, conversationId: resolved.conversationId, conversation, messageBody: event.messageBody });
      } catch (notificationError) {
        console.error("Unable to notify account about inbound lead message", notificationError);
      }
    }
    return NextResponse.json({ ok: true, clientId, conversationId: resolved.conversationId, messageId: messageRef.id, keyword: keyword || null, supportUrl: keyword === "help" ? ARK_SUPPORT_URL : null, notification });
  } catch (error) {
    console.error("Unable to process Telnyx messaging webhook", error);
    return NextResponse.json({ error: "Could not process the messaging webhook." }, { status: 500 });
  }
}
