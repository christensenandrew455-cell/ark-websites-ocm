import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function conversationId(clientId, collectionKey, leadId) {
  return createHash("sha256").update(`${clientId}:${collectionKey}:${leadId}`).digest("hex").slice(0, 48);
}

function normalizeLead(document, collectionKey) {
  const data = document.data();
  return {
    id: document.id,
    collectionKey,
    name: text(data.Name || data.name || data.fullName) || "Unnamed lead",
    phone: text(data.Phone || data.phone || data.phoneNumber),
    email: text(data.Email || data.email),
    job: text(data.Job || data.job || data.service || data.projectType),
    address: text(data.Address || data.address),
    assignedEmployeeUid: text(data.assignedEmployeeUid),
    assignedEmployeeName: text(data.assignedEmployeeName),
  };
}

async function authorizeMessaging(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  if (!decoded.clientId || !["customer", "employee"].includes(decoded.role)) {
    return { response: NextResponse.json({ error: "A Solo Pro, Business owner, or approved employee account is required." }, { status: 403 }) };
  }
  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").doc(decoded.uid).get();
  if (!accountSnapshot.exists) return { response: NextResponse.json({ error: "This account could not be found." }, { status: 404 }) };
  const account = accountSnapshot.data();
  const isEmployee = decoded.role === "employee" || account.role === "employee";
  const plan = text(account.billingPlan || decoded.billingPlan);
  if (account.status !== "active") {
    return { response: NextResponse.json({ error: isEmployee ? "The business owner has not approved this employee account." : "This account is not active." }, { status: 403 }) };
  }
  if (!isEmployee && !["solo_pro", "business"].includes(plan)) {
    return { response: NextResponse.json({ error: "Lead messaging is available on Solo Pro and Business." }, { status: 403 }) };
  }
  if (isEmployee && plan !== "business") {
    return { response: NextResponse.json({ error: "This employee account is not attached to an active Business plan." }, { status: 403 }) };
  }
  return { db, decoded, account, clientId: text(decoded.clientId), isEmployee, plan };
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
  const snapshots = await Promise.all(collections.map((key) => access.isEmployee
    ? root.collection(key).where("assignedEmployeeUid", "==", access.decoded.uid).get()
    : root.collection(key).get()));
  return snapshots.flatMap((snapshot, index) => snapshot.docs.map((document) => normalizeLead(document, collections[index])));
}

async function loadConversations(access) {
  const ref = access.db.collection("ocmClients").doc(access.clientId).collection("leadConversations");
  const snapshot = access.isEmployee
    ? await ref.where("assignedEmployeeUid", "==", access.decoded.uid).get()
    : await ref.get();
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
      lastMessageAt: iso(data.lastMessageAt || data.updatedAt || data.createdAt),
      createdAt: iso(data.createdAt),
    };
  }).sort((first, second) => String(second.lastMessageAt).localeCompare(String(first.lastMessageAt)));
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
      selectedConversation = conversations.find((item) => item.id === key) || {
        id: key,
        leadId: selectedLeadId,
        collectionKey: selectedCollection,
        leadName: loaded.lead.name,
        leadPhone: loaded.lead.phone,
        assignedEmployeeUid: loaded.lead.assignedEmployeeUid,
        assignedEmployeeName: loaded.lead.assignedEmployeeName,
        newConversation: true,
      };
      const conversationSnapshot = await access.db.collection("ocmClients").doc(access.clientId).collection("leadConversations").doc(key).get();
      if (conversationSnapshot.exists) messages = await loadMessages(access, key);
    }
    return NextResponse.json({
      role: access.isEmployee ? "employee" : "owner",
      plan: access.plan,
      messagingConnected: Boolean(text(process.env.ARK_MESSAGING_WEBHOOK_URL)),
      availableLeads,
      conversations,
      selectedConversation,
      messages,
    });
  } catch (error) {
    console.error("Unable to load lead conversations", error);
    return NextResponse.json({ error: "Could not load lead messages." }, { status: 500 });
  }
}

async function sendThroughProvider(payload) {
  const webhookUrl = text(process.env.ARK_MESSAGING_WEBHOOK_URL);
  if (!webhookUrl) return { status: "provider-not-configured", providerMessageId: "" };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ARK_MESSAGING_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.ARK_MESSAGING_WEBHOOK_SECRET}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { status: "provider-error", providerMessageId: text(result.messageId || result.id), providerError: text(result.error) || `Provider returned ${response.status}.` };
    return { status: "sent", providerMessageId: text(result.messageId || result.id) };
  } catch (error) {
    return { status: "provider-error", providerMessageId: "", providerError: text(error.message) };
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
    if (!loaded.lead.phone) return NextResponse.json({ error: "This lead does not have a phone number for text messaging." }, { status: 409 });

    const key = conversationId(access.clientId, collectionKey, leadId);
    const root = access.db.collection("ocmClients").doc(access.clientId);
    const conversationRef = root.collection("leadConversations").doc(key);
    const billingRef = root.collection("billingConversationEvents").doc(key);
    const existingConversation = await conversationRef.get();
    const provider = await sendThroughProvider({
      clientId: access.clientId,
      conversationId: key,
      leadId,
      collectionKey,
      to: loaded.lead.phone,
      leadName: loaded.lead.name,
      message: messageBody,
      senderUid: access.decoded.uid,
      senderRole: access.isEmployee ? "employee" : "owner",
    });

    const messageRef = conversationRef.collection("messages").doc();
    const batch = access.db.batch();
    if (!existingConversation.exists) {
      batch.create(conversationRef, {
        conversationId: key,
        leadId,
        collectionKey,
        leadName: loaded.lead.name,
        leadPhone: loaded.lead.phone,
        assignedEmployeeUid: loaded.lead.assignedEmployeeUid || null,
        assignedEmployeeName: loaded.lead.assignedEmployeeName || null,
        startedByUid: access.decoded.uid,
        startedByRole: access.isEmployee ? "employee" : "owner",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(billingRef, {
        conversationId: key,
        leadId,
        collectionKey,
        startedAt: FieldValue.serverTimestamp(),
        startedByUid: access.decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(messageRef, {
      direction: "outbound",
      body: messageBody,
      senderUid: access.decoded.uid,
      senderName: text(access.account.employeeName || access.account.ownerName || access.account.accountEmail),
      senderRole: access.isEmployee ? "employee" : "owner",
      deliveryStatus: provider.status,
      providerMessageId: provider.providerMessageId || null,
      providerError: provider.providerError || null,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(conversationRef, {
      leadName: loaded.lead.name,
      leadPhone: loaded.lead.phone,
      assignedEmployeeUid: loaded.lead.assignedEmployeeUid || null,
      assignedEmployeeName: loaded.lead.assignedEmployeeName || null,
      lastMessage: messageBody,
      lastMessageDirection: "outbound",
      lastMessageAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    return NextResponse.json({
      ok: true,
      conversationId: key,
      newConversation: !existingConversation.exists,
      deliveryStatus: provider.status,
      notice: provider.status === "provider-not-configured"
        ? "The conversation was saved in ARK, but an outbound messaging provider is not connected yet."
        : provider.status === "sent"
          ? "Message sent."
          : "The conversation was saved, but the messaging provider reported an error.",
    });
  } catch (error) {
    console.error("Unable to send lead message", error);
    return NextResponse.json({ error: "Could not send this lead message." }, { status: 500 });
  }
}
