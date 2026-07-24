import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
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
function normalizeLead(document, collectionKey) {
  const data = document.data();
  const phone = text(data.Phone || data.phone || data.phoneNumber);
  return {
    id: document.id,
    collectionKey,
    name: text(data.Name || data.name || data.fullName) || "Unnamed lead",
    phone,
    phoneNormalized: normalizePhone(phone),
    email: text(data.Email || data.email),
    job: text(data.Job || data.job || data.service || data.projectType),
    address: text(data.Address || data.address),
    assignedEmployeeUid: text(data.assignedEmployeeUid),
    assignedEmployeeName: text(data.assignedEmployeeName),
    lastActivityAt: iso(data.updatedAt || data.acceptedAt || data.createdAt),
  };
}

async function authorizeMessaging(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  if (!["customer", "employee"].includes(decoded.role)) return { response: NextResponse.json({ error: "An owner or approved employee account is required." }, { status: 403 }) };
  const clientId = text(decoded.role === "employee" ? decoded.businessClientId || decoded.clientId : decoded.clientId);
  if (!clientId) return { response: NextResponse.json({ error: "This account does not have a business workspace." }, { status: 403 }) };
  const db = getAdminDb();
  const [accountSnapshot, businessSnapshot, connectionSnapshot, receptionistSnapshot] = await Promise.all([
    db.collection("accounts").doc(decoded.uid).get(),
    db.collection("businesses").doc(clientId).get(),
    db.collection("connections").doc(clientId).get(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist").get(),
  ]);
  if (!accountSnapshot.exists || !businessSnapshot.exists) return { response: NextResponse.json({ error: "This account could not be found." }, { status: 404 }) };
  const account = accountSnapshot.data();
  const business = businessSnapshot.data();
  const connection = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const receptionist = receptionistSnapshot.exists ? receptionistSnapshot.data() : {};
  const isEmployee = decoded.role === "employee" || account.role === "employee";
  if (text(account.clientId) !== clientId) return { response: NextResponse.json({ error: "This account does not match the requested workspace." }, { status: 403 }) };
  if (account.status !== "active") return { response: NextResponse.json({ error: isEmployee ? "The owner has not approved this employee account." : "This account is not active." }, { status: 403 }) };
  if (business.messagesEnabled !== true) return { response: NextResponse.json({ error: "Turn on Messages in Settings to use lead messaging." }, { status: 403 }) };
  if (isEmployee && (business.employeesEnabled !== true || business.employeeMessagingEnabled !== true)) return { response: NextResponse.json({ error: "The owner has not enabled messaging for employees." }, { status: 403 }) };
  const fromPhone = normalizePhone(connection.receptionistPhoneNormalized || receptionist.receptionistPhoneNormalized || connection.receptionistPhone || receptionist.receptionistPhone);
  return { db, decoded, account, business, clientId, isEmployee, fromPhone };
}

async function loadLead(access, collectionKey, leadId) {
  const key = collectionKey === "clients" ? "clients" : "contactedMe";
  const ref = access.db.collection("ocmClients").doc(access.clientId).collection(key).doc(text(leadId));
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const lead = normalizeLead(snapshot, key);
  if (access.isEmployee && lead.assignedEmployeeUid !== access.decoded.uid) return null;
  return { ref, lead };
}

async function loadAvailableLeads(access) {
  const root = access.db.collection("ocmClients").doc(access.clientId);
  const collections = ["contactedMe", "clients"];
  const snapshots = await Promise.all(collections.map((key) => access.isEmployee ? root.collection(key).where("assignedEmployeeUid", "==", access.decoded.uid).get() : root.collection(key).get()));
  return snapshots.flatMap((snapshot, index) => snapshot.docs.map((document) => normalizeLead(document, collections[index]))).sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
}

async function loadConversations(access) {
  const ref = access.db.collection("ocmClients").doc(access.clientId).collection("leadConversations");
  const snapshot = access.isEmployee ? await ref.where("assignedEmployeeUid", "==", access.decoded.uid).get() : await ref.get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      leadId: text(data.leadId),
      collectionKey: text(data.collectionKey || "contactedMe"),
      leadName: text(data.leadName) || "Unnamed lead",
      leadPhone: text(data.leadPhone),
      assignedEmployeeUid: text(data.assignedEmployeeUid),
      assignedEmployeeName: text(data.assignedEmployeeName),
      lastMessage: text(data.lastMessage),
      lastMessageDirection: text(data.lastMessageDirection),
      unreadCount: access.isEmployee ? Number(data.employeeUnreadCount || 0) : Number(data.ownerUnreadCount || 0),
      lastMessageAt: iso(data.lastMessageAt || data.updatedAt || data.createdAt),
      createdAt: iso(data.createdAt),
    };
  }).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
}

async function loadMessages(access, conversationKey) {
  const snapshot = await access.db.collection("ocmClients").doc(access.clientId).collection("leadConversations").doc(conversationKey).collection("messages").orderBy("createdAt", "asc").limit(250).get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      direction: text(data.direction || "outbound"),
      body: text(data.body),
      senderName: text(data.senderName),
      senderRole: text(data.senderRole),
      deliveryStatus: text(data.deliveryStatus),
      providerErrorCode: text(data.providerErrorCode),
      providerError: text(data.providerError),
      createdAt: iso(data.createdAt),
    };
  });
}

export async function GET(request) {
  const access = await authorizeMessaging(request);
  if (access.response) return access.response;
  try {
    const url = new URL(request.url);
    const selectedLeadId = text(url.searchParams.get("lead"));
    const selectedCollection = url.searchParams.get("collection") === "clients" ? "clients" : "contactedMe";
    const [availableLeads, conversations] = await Promise.all([loadAvailableLeads(access), loadConversations(access)]);
    let selectedConversation = null;
    let messages = [];
    if (selectedLeadId) {
      const loaded = await loadLead(access, selectedCollection, selectedLeadId);
      if (!loaded) return NextResponse.json({ error: "That lead is not available to this account." }, { status: 404 });
      const key = conversationId(access.clientId, selectedCollection, selectedLeadId);
      selectedConversation = conversations.find((item) => item.id === key) || { id: key, leadId: selectedLeadId, collectionKey: selectedCollection, leadName: loaded.lead.name, leadPhone: loaded.lead.phone, assignedEmployeeUid: loaded.lead.assignedEmployeeUid, assignedEmployeeName: loaded.lead.assignedEmployeeName, newConversation: true };
      const conversationRef = access.db.collection("ocmClients").doc(access.clientId).collection("leadConversations").doc(key);
      const conversationSnapshot = await conversationRef.get();
      if (conversationSnapshot.exists) {
        messages = await loadMessages(access, key);
        await conversationRef.set(access.isEmployee ? { employeeUnreadCount: 0, employeeLastReadAt: FieldValue.serverTimestamp() } : { ownerUnreadCount: 0, ownerLastReadAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
    return NextResponse.json({
      role: access.isEmployee ? "employee" : "owner",
      messagingConnected: Boolean(process.env.TELNYX_API_KEY && access.fromPhone),
      messagingPhone: access.fromPhone,
      availableLeads,
      conversations,
      selectedConversation,
      messages,
      unreadCount: conversations.reduce((total, item) => total + Number(item.unreadCount || 0), 0),
    });
  } catch (error) {
    console.error("Unable to load lead conversations", error);
    return NextResponse.json({ error: "Could not load messages." }, { status: 500 });
  }
}

async function sendThroughTelnyx({ from, to, message }) {
  const apiKey = text(process.env.TELNYX_API_KEY);
  if (!apiKey || !from) return { status: "provider-not-configured", providerMessageId: "", providerErrorCode: "", providerError: "The connected business number is not configured for Telnyx messaging." };
  try {
    const appOrigin = text(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
    const webhookUrl = appOrigin ? `${appOrigin}/api/business/lead-messages/incoming` : "";
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: normalizePhone(to),
        text: message,
        use_profile_webhooks: true,
        ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
      }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    const providerMessageId = text(result?.data?.id || result?.id);
    const destination = Array.isArray(result?.data?.to) ? result.data.to[0] : null;
    const firstError = Array.isArray(result?.errors) ? result.errors[0] : Array.isArray(result?.data?.errors) ? result.data.errors[0] : null;
    const providerErrorCode = text(firstError?.code);
    const providerError = text(firstError?.detail || firstError?.title || result?.error);
    if (!response.ok) return { status: "provider-error", providerMessageId, providerErrorCode, providerError: providerError || `Telnyx returned ${response.status}.` };
    return { status: text(destination?.status) || "queued", providerMessageId, providerErrorCode, providerError };
  } catch (error) {
    return { status: "provider-error", providerMessageId: "", providerErrorCode: "", providerError: text(error.message) };
  }
}

export async function POST(request) {
  const access = await authorizeMessaging(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    const collectionKey = body.collectionKey === "clients" ? "clients" : "contactedMe";
    const messageBody = text(body.message).slice(0, 1600);
    if (!leadId || !messageBody) return NextResponse.json({ error: "Choose a lead and enter a message." }, { status: 400 });
    const loaded = await loadLead(access, collectionKey, leadId);
    if (!loaded) return NextResponse.json({ error: "That lead is not available to this account." }, { status: 404 });
    if (!loaded.lead.phoneNormalized) return NextResponse.json({ error: "This lead does not have a valid phone number for text messaging." }, { status: 409 });
    if (!access.fromPhone) return NextResponse.json({ error: "This business does not have a connected Telnyx number." }, { status: 409 });

    const key = conversationId(access.clientId, collectionKey, leadId);
    const root = access.db.collection("ocmClients").doc(access.clientId);
    const conversationRef = root.collection("leadConversations").doc(key);
    const billingRef = root.collection("billingConversationEvents").doc(key);
    const existingConversation = await conversationRef.get();
    const provider = await sendThroughTelnyx({ from: access.fromPhone, to: loaded.lead.phoneNormalized, message: messageBody });
    const messageRef = conversationRef.collection("messages").doc();
    const batch = access.db.batch();
    if (!existingConversation.exists) batch.set(billingRef, { conversationId: key, leadId, collectionKey, startedAt: FieldValue.serverTimestamp(), startedByUid: access.decoded.uid, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(messageRef, {
      direction: "outbound",
      body: messageBody,
      senderUid: access.decoded.uid,
      senderName: text(access.account.employeeName || access.account.ownerName || access.account.accountEmail),
      senderRole: access.isEmployee ? "employee" : "owner",
      deliveryStatus: provider.status,
      providerMessageId: provider.providerMessageId || null,
      providerErrorCode: provider.providerErrorCode || null,
      providerError: provider.providerError || null,
      providerFrom: access.fromPhone,
      providerTo: loaded.lead.phoneNormalized,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (provider.providerMessageId) {
      batch.set(root.collection("telnyxMessageIndex").doc(provider.providerMessageId), {
        providerMessageId: provider.providerMessageId,
        conversationId: key,
        messageId: messageRef.id,
        fromPhone: access.fromPhone,
        toPhone: loaded.lead.phoneNormalized,
        deliveryStatus: provider.status,
        providerErrorCode: provider.providerErrorCode || null,
        providerError: provider.providerError || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(conversationRef, {
      conversationId: key,
      leadId,
      collectionKey,
      leadName: loaded.lead.name,
      leadPhone: loaded.lead.phone,
      leadPhoneNormalized: loaded.lead.phoneNormalized,
      businessPhone: access.fromPhone,
      assignedEmployeeUid: loaded.lead.assignedEmployeeUid || null,
      assignedEmployeeName: loaded.lead.assignedEmployeeName || null,
      lastMessage: messageBody,
      lastMessageDirection: "outbound",
      lastMessageAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(!existingConversation.exists ? { startedByUid: access.decoded.uid, startedByRole: access.isEmployee ? "employee" : "owner", ownerUnreadCount: 0, employeeUnreadCount: 0, createdAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    await batch.commit();

    const notice = provider.status === "provider-not-configured"
      ? "The message was saved, but this business number is not configured for Telnyx messaging."
      : provider.status === "provider-error"
        ? `Telnyx rejected the message${provider.providerErrorCode ? ` (${provider.providerErrorCode})` : ""}: ${provider.providerError || "Unknown error."}`
        : `Message ${provider.status || "queued"}.`;
    return NextResponse.json({ ok: true, conversationId: key, newConversation: !existingConversation.exists, deliveryStatus: provider.status, providerErrorCode: provider.providerErrorCode, providerError: provider.providerError, notice });
  } catch (error) {
    console.error("Unable to send lead message", error);
    return NextResponse.json({ error: "Could not send this message." }, { status: 500 });
  }
}
