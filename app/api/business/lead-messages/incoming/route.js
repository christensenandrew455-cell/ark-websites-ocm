import { createHash, createPublicKey, verify } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
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
  const to = Array.isArray(payload?.to) ? payload.to[0]?.phone_number || payload.to[0]?.number : payload?.to?.phone_number || payload?.to;
  const from = payload?.from?.phone_number || payload?.from?.number || payload?.from;
  return {
    eventType: text(event?.event_type || body?.event_type),
    toPhone: normalizePhone(to || body?.toPhone || body?.recipient),
    fromPhone: normalizePhone(from || body?.fromPhone || body?.sender),
    messageBody: text(payload?.text || payload?.body || body?.message || body?.body).slice(0, 1600),
    providerMessageId: text(payload?.id || body?.providerMessageId || body?.messageId),
    senderName: text(body?.senderName),
    clientId: text(body?.clientId),
    providedConversationId: text(body?.conversationId),
  };
}
async function resolveClientId(db, suppliedClientId, toPhone) {
  if (suppliedClientId) return suppliedClientId;
  if (!toPhone) return "";
  const normalizedMatch = await db.collection("connections").where("receptionistPhoneNormalized", "==", toPhone).limit(1).get();
  if (!normalizedMatch.empty) return normalizedMatch.docs[0].id;
  const rawMatch = await db.collection("connections").where("receptionistPhone", "==", toPhone).limit(1).get();
  return rawMatch.empty ? "" : rawMatch.docs[0].id;
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
    const inbound = parsePayload(body);
    if (inbound.eventType && inbound.eventType !== "message.received") return NextResponse.json({ ok: true, ignored: true });
    if (!inbound.messageBody || !inbound.fromPhone) return NextResponse.json({ error: "An inbound phone number and message are required." }, { status: 400 });

    const db = getAdminDb();
    const clientId = await resolveClientId(db, inbound.clientId, inbound.toPhone);
    if (!clientId) return NextResponse.json({ error: "No ARK business is assigned to that Telnyx number." }, { status: 404 });

    const resolved = await resolveConversation(db, clientId, inbound.fromPhone, inbound.providedConversationId);
    if (!resolved) return NextResponse.json({ error: "No lead in this business matches the incoming phone number." }, { status: 404 });

    const conversation = resolved.conversation;
    const messageRef = resolved.ref.collection("messages").doc();
    const batch = db.batch();
    if (resolved.created) {
      batch.set(db.collection("ocmClients").doc(clientId).collection("billingConversationEvents").doc(resolved.conversationId), {
        conversationId: resolved.conversationId,
        leadId: conversation.leadId,
        collectionKey: conversation.collectionKey,
        startedAt: FieldValue.serverTimestamp(),
        startedByRole: "lead",
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(messageRef, {
      direction: "inbound",
      body: inbound.messageBody,
      senderName: inbound.senderName || conversation.leadName || inbound.fromPhone,
      senderRole: "lead",
      providerMessageId: inbound.providerMessageId || null,
      providerFrom: inbound.fromPhone,
      providerTo: inbound.toPhone || null,
      deliveryStatus: "received",
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(resolved.ref, {
      ...conversation,
      businessPhone: inbound.toPhone || conversation.businessPhone || null,
      lastMessage: inbound.messageBody,
      lastMessageDirection: "inbound",
      lastMessageAt: FieldValue.serverTimestamp(),
      ownerUnreadCount: FieldValue.increment(1),
      ...(text(conversation.assignedEmployeeUid) ? { employeeUnreadCount: FieldValue.increment(1) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      ...(resolved.created ? { createdAt: FieldValue.serverTimestamp(), ownerUnreadCount: 1, employeeUnreadCount: text(conversation.assignedEmployeeUid) ? 1 : 0 } : {}),
    }, { merge: true });
    await batch.commit();

    let notification = { attempted: 0, sent: 0, failed: 0 };
    try {
      notification = await sendInboundMessageNotification({ db, clientId, conversationId: resolved.conversationId, conversation, messageBody: inbound.messageBody });
    } catch (notificationError) {
      console.error("Unable to notify account about inbound lead message", notificationError);
    }
    return NextResponse.json({ ok: true, clientId, conversationId: resolved.conversationId, messageId: messageRef.id, notification });
  } catch (error) {
    console.error("Unable to record inbound Telnyx message", error);
    return NextResponse.json({ error: "Could not record the inbound message." }, { status: 500 });
  }
}
