import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { computeBillingState } from "../../lib/billingDelinquency";
import { sendAdminEvent } from "../../lib/adminEvents";
import { getAdminDb } from "../../lib/firebase-admin";
import { systemCollection } from "../../lib/firestoreLayout";
import { requireUser } from "../../lib/userRequest";
import { normalizeClientId, toIsoString, trimmedText } from "../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["new", "in-progress", "completed", "denied"]);
const OPEN_STATUSES = new Set(["new", "in-progress"]);

function requestPayload(document) {
  const data = document.data();
  return {
    id: document.id,
    clientId: trimmedText(data.clientId),
    businessName: trimmedText(data.businessName),
    ownerName: trimmedText(data.ownerName),
    accountEmail: trimmedText(data.accountEmail),
    type: ["change", "feedback", "website"].includes(data.type) ? data.type : "help",
    subject: trimmedText(data.subject),
    message: trimmedText(data.message),
    status: ALLOWED_STATUSES.has(data.status) ? data.status : "new",
    adminNote: trimmedText(data.adminNote),
    adminReply: trimmedText(data.adminReply),
    repliedAt: toIsoString(data.repliedAt),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    closedAt: toIsoString(data.closedAt),
  };
}
export async function GET(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const clientId = normalizeClientId(user.decodedToken.clientId);
  if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });

  const snapshot = await systemCollection(getAdminDb(), "supportRequests").where("clientId", "==", clientId).get();
  const requests = snapshot.docs
    .map(requestPayload)
    .filter((item) => !["website", "feedback"].includes(item.type))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  return NextResponse.json({ requests });
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const body = await request.json();
  const subject = trimmedText(body.subject);
  const message = trimmedText(body.message);
  const clientId = normalizeClientId(user.decodedToken.clientId);

  if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });
  if (subject.length < 4) return NextResponse.json({ error: "Add a short subject so ARK can identify the problem." }, { status: 400 });
  if (message.length < 10) return NextResponse.json({ error: "Describe what you need help with in at least 10 characters." }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "Keep the help request under 4,000 characters." }, { status: 400 });

  const db = getAdminDb();
  const [accountSnapshot, existingRequests] = await Promise.all([
    db.collection("accounts").doc(clientId).get(),
    systemCollection(db, "supportRequests").where("clientId", "==", clientId).get(),
  ]);
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  if (computeBillingState(account).restricted) {
    return NextResponse.json({ error: "Help requests are unavailable while the account is payment-restricted. Update the payment method to restore full access." }, { status: 402 });
  }

  const alreadyOpen = existingRequests.docs.some((document) => {
    const data = document.data();
    return data.type === "help"
      && trimmedText(data.createdByUid) === user.decodedToken.uid
      && OPEN_STATUSES.has(ALLOWED_STATUSES.has(data.status) ? data.status : "new");
  });
  if (alreadyOpen) return NextResponse.json({ error: "You already have an open help request. Check Help History for its status or ARK's reply." }, { status: 409 });

  const ref = systemCollection(db, "supportRequests").doc();
  const businessName = trimmedText(account.businessName || clientId);
  await ref.set({
    clientId,
    businessName,
    ownerName: trimmedText(account.ownerName || user.decodedToken.name),
    accountEmail: trimmedText(account.accountEmail || user.decodedToken.email).toLowerCase(),
    contactPhone: trimmedText(account.accountPhone),
    type: "help",
    subject: subject || "Help request",
    message,
    status: "new",
    priority: "normal",
    createdByUid: user.decodedToken.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await sendAdminEvent({
    id: `help-${ref.id}`,
    type: "support.help.created",
    clientId,
    businessName,
    summary: subject,
    metadata: { requestId: ref.id },
  });
  return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
}
