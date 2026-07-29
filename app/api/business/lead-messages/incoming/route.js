import { createHash, createPublicKey, verify } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { deleteLeadConversation } from "../../../../lib/messageRetention";
import {
  ARK_SUPPORT_URL,
  helpConfirmationMessage,
  messagingKeyword,
  optInKeywordConfirmationMessage,
  optOutCanceledMessage,
  optOutConfirmationMessage,
  optOutRequestMessage,
} from "../../../../lib/messagingCompliance";
import { smsPartCount } from "../../../../lib/smsParts";
import { sendInboundMessageNotification } from "../../../../lib/messageNotificationService";

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
  const normalizedMatch = await db.collection("connections").where("receptionistPhoneNormalized", "==", businessPhone).limit(1).get();
  if (!normalizedMatch.empty) return normalizedMatch.docs[0].id;
  const rawMatch = await db.collection("connections").where("receptionistPhone", "==", businessPhone).limit(1).get();
  return rawMatch.empty ? "" : rawMatch.docs[0].id;
}
async function findOutboundMessage(db, clientId, providerMessageId) {
  const root = db.collection("ocmClients").doc(clientId);
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
  const root = db.collection("ocmClients").doc(clientId);
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
  for (const collectionKey of ["contactedMe", "clients"]) {
    const leads = await root.collection(collectionKey).get();
    const leadDocument = leads.docs.find((document) => normalizePhone(document.data().Phone || document.data().phone || document.data().phoneNumber) === fromPhone);
    if (!leadDocument) continue;
    const lead = leadDocument.data();
    const id = conversationId(clientId, collectionKey, leadDocument.id);
    const ref = root.collection("leadConversations").doc(id);
    return {
      ref,
      snapshot: null,
      conversationId: id,
      created: true,
      conversation: {
        conversationId: id,
        leadId: leadDocument.id,
        collectionKey,
        leadName: text(lead.Name || lead.name || lead.fullName) || "Unnamed lead",
        leadPhone: text(lead.Phone || lead.phone || lead.phoneNumber),
        leadPhoneNormalized: fromPhone,
        assignedEmployeeUid: text(lead.assignedEmployeeUid) || null,
        assignedEmployeeName: text(lead.assignedEmployeeName) || null,
      },
    };
  }
  return null;
}

export async function POST(request) {
  const rawBody = await request.text();
  if (!secretMatches(request) && !telnyxSignatureMatches(request, rawBody)) return NextResponse.json({ error: "Invalid messaging webhook credentials." }, { status: 401 });
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
    const resolved = await resolveConversation(db, clientId, event.fromPhone, event.providedConversationId);
    if (!resolved) return NextResponse.json({ error: "No lead in this business matches the incoming phone number." }, { status: 404 });

    const root = db.collection("ocmClients").doc(clientId);
    const businessSnapshot = await db.collection("businesses").doc(clientId).get();
    const business = businessSnapshot.exists ? businessSnapshot.data() : {};
    const businessName = text(business.businessName || business.name) || "the business";
    const keyword = messagingKeyword(event.messageBody);
    const conversation = resolved.conversation;
    const pendingOptOut = conversation.messagingOptOutPending === true;

    if (keyword === "confirm" && pendingOptOut) {
      const auditRef = db.collection("messagingComplianceEvents").doc();
      await auditRef.set({
        clientId,
        businessName,
        conversationId: resolved.conversationId,
        leadId: conversation.leadId || null,
        leadName: conversation.leadName || null,
        reporterPhone: event.fromPhone,
        businessPhone: event.toPhone || null,
        keyword: "confirm-stop",
        originalMessage: event.messageBody,
        expectedTelnyxAutoResponse: optOutConfirmationMessage(businessName),
        status: "confirmed-and-deleted",
        source: "telnyx-keyword",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const leadId = text(conversation.leadId);
      const collectionKey = conversation.collectionKey === "clients" ? "clients" : "contactedMe";
      if (leadId) await root.collection(collectionKey).doc(leadId).delete().catch(() => null);
      await deleteLeadConversation(db, root, resolved.ref);
      return NextResponse.json({ ok: true, clientId, conversationId: resolved.conversationId, keyword: "confirm", optedOut: true, deleted: true });
    }

    const messageRef = resolved.ref.collection("messages").doc();
    const batch = db.batch();
    const parts = smsPartCount(event.messageBody);
    batch.set(messageRef, {
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
    });

    const compliancePatch = keyword === "stop"
      ? { messagingOptOutPending: true, messagingOptOutRequestedAt: FieldValue.serverTimestamp(), lastComplianceKeyword: "STOP" }
      : keyword === "start"
        ? { messagingOptOutPending: false, messagingOptedOut: false, messagingOptedInAt: FieldValue.serverTimestamp(), lastComplianceKeyword: "START" }
        : keyword === "help"
          ? { supportRequestedAt: FieldValue.serverTimestamp(), lastComplianceKeyword: "HELP" }
          : keyword === "cancel" && pendingOptOut
            ? { messagingOptOutPending: false, lastComplianceKeyword: "CANCEL" }
            : {};

    batch.set(resolved.ref, {
      ...conversation,
      businessPhone: event.toPhone || conversation.businessPhone || null,
      smsParts: FieldValue.increment(parts),
      lastMessage: event.messageBody,
      lastMessageDirection: "inbound",
      lastMessageAt: FieldValue.serverTimestamp(),
      ownerUnreadCount: keyword ? Number(conversation.ownerUnreadCount || 0) : FieldValue.increment(1),
      ...(!keyword && text(conversation.assignedEmployeeUid) ? { employeeUnreadCount: FieldValue.increment(1) } : {}),
      ...compliancePatch,
      updatedAt: FieldValue.serverTimestamp(),
      ...(resolved.created ? { createdAt: FieldValue.serverTimestamp(), ownerUnreadCount: keyword ? 0 : 1, employeeUnreadCount: !keyword && text(conversation.assignedEmployeeUid) ? 1 : 0 } : {}),
    }, { merge: true });

    if (keyword) {
      const eventRef = db.collection("messagingComplianceEvents").doc();
      const expectedResponse = keyword === "stop"
        ? optOutRequestMessage(businessName)
        : keyword === "start"
          ? optInKeywordConfirmationMessage(businessName)
          : keyword === "cancel" && pendingOptOut
            ? optOutCanceledMessage(businessName)
            : keyword === "help"
              ? helpConfirmationMessage()
              : "";
      batch.set(eventRef, {
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
        status: keyword === "help" ? "open" : "recorded",
        source: "telnyx-keyword",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    let notification = { attempted: 0, sent: 0, failed: 0 };
    if (!keyword) {
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
