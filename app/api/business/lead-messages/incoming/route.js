import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { sendInboundMessageNotification } from "../../../../lib/messageNotificationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function secretMatches(request) {
  const expected = text(process.env.ARK_MESSAGING_INBOUND_SECRET || process.env.ARK_MESSAGING_WEBHOOK_SECRET);
  const authorization = text(request.headers.get("authorization"));
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : text(request.headers.get("x-ark-messaging-secret"));
  return Boolean(expected && provided && expected === provided);
}

export async function POST(request) {
  if (!secretMatches(request)) return NextResponse.json({ error: "Invalid messaging webhook credentials." }, { status: 401 });
  try {
    const body = await request.json();
    const clientId = text(body.clientId);
    const conversationId = text(body.conversationId);
    const messageBody = text(body.message || body.body).slice(0, 1600);
    if (!clientId || !conversationId || !messageBody) return NextResponse.json({ error: "clientId, conversationId, and message are required." }, { status: 400 });

    const db = getAdminDb();
    const conversationRef = db.collection("ocmClients").doc(clientId).collection("leadConversations").doc(conversationId);
    const conversationSnapshot = await conversationRef.get();
    if (!conversationSnapshot.exists) return NextResponse.json({ error: "That lead conversation does not exist." }, { status: 404 });
    const conversation = conversationSnapshot.data();

    const messageRef = conversationRef.collection("messages").doc();
    const batch = db.batch();
    batch.set(messageRef, { direction: "inbound", body: messageBody, senderName: text(body.senderName || conversation.leadName || body.from), senderRole: "lead", providerMessageId: text(body.providerMessageId || body.messageId) || null, providerFrom: text(body.from) || null, deliveryStatus: "received", createdAt: FieldValue.serverTimestamp() });
    batch.set(conversationRef, { lastMessage: messageBody, lastMessageDirection: "inbound", lastMessageAt: FieldValue.serverTimestamp(), ownerUnreadCount: FieldValue.increment(1), ...(text(conversation.assignedEmployeeUid) ? { employeeUnreadCount: FieldValue.increment(1) } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();

    let notification = { attempted: 0, sent: 0, failed: 0 };
    try {
      notification = await sendInboundMessageNotification({ db, clientId, conversationId, conversation, messageBody });
    } catch (notificationError) {
      console.error("Unable to notify account about inbound lead message", notificationError);
    }
    return NextResponse.json({ ok: true, messageId: messageRef.id, notification });
  } catch (error) {
    console.error("Unable to record inbound lead message", error);
    return NextResponse.json({ error: "Could not record the inbound message." }, { status: 500 });
  }
}
