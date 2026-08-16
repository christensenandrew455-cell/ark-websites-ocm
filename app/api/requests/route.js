import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { computeBillingState } from "../../lib/billingDelinquency";
import { getAdminDb } from "../../lib/firebase-admin";
import { systemCollection } from "../../lib/firestoreLayout";
import { sendRequestStatusNotification } from "../../lib/notificationService";
import { requireUser } from "../../lib/userRequest";
import { normalizeClientId, toIsoString, trimmedText } from "../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORICAL_TYPES = new Set(["help", "change", "website"]);
const ALLOWED_STATUSES = new Set(["new", "in-progress", "completed", "denied"]);
const OPEN_STATUSES = new Set(["new", "in-progress"]);
const STATUS_TRANSITIONS = {
  new: new Set(["in-progress", "denied"]),
  "in-progress": new Set(["completed"]),
  completed: new Set(),
  denied: new Set(),
};

function requestPayload(document) {
  const data = document.data();
  const source = trimmedText(data.source);
  const isWebsiteRequest = data.type === "website" || source === "public-website";
  const attachment = data.attachment && typeof data.attachment === "object"
    ? {
        fileName: trimmedText(data.attachment.fileName),
        contentType: trimmedText(data.attachment.contentType),
        size: Math.max(0, Number(data.attachment.size || 0)),
        downloadUrl: `/api/admin/website-requests/${encodeURIComponent(document.id)}/attachment`,
      }
    : null;
  return {
    id: document.id,
    clientId: trimmedText(data.clientId),
    businessName: trimmedText(data.businessName),
    ownerName: trimmedText(data.ownerName),
    accountEmail: trimmedText(data.accountEmail),
    type: isWebsiteRequest ? "website" : HISTORICAL_TYPES.has(data.type) ? data.type : "help",
    source,
    category: trimmedText(data.category),
    categoryLabel: trimmedText(data.categoryLabel),
    contactEmail: trimmedText(data.contactEmail || data.accountEmail).toLowerCase(),
    contactPhone: trimmedText(data.contactPhone),
    senderNumber: trimmedText(data.senderNumber),
    contactConsent: data.contactConsent === true,
    attachment,
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

  const db = getAdminDb();
  const isAdmin = user.decodedToken.role === "admin";
  const tokenClientId = normalizeClientId(user.decodedToken.clientId);
  const url = new URL(request.url);
  const requestedClientId = normalizeClientId(url.searchParams.get("clientId"));
  const includeClosed = url.searchParams.get("includeClosed") === "1";
  const sourceFilter = trimmedText(url.searchParams.get("source"));
  const requestCollection = systemCollection(db, "supportRequests");

  let snapshot;
  if (isAdmin) {
    snapshot = requestedClientId
      ? await requestCollection.where("clientId", "==", requestedClientId).get()
      : await requestCollection.get();
  } else {
    if (!tokenClientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });
    snapshot = await requestCollection.where("clientId", "==", tokenClientId).get();
  }

  let requests = snapshot.docs.map(requestPayload);
  if (isAdmin && sourceFilter === "public-website") {
    requests = requests.filter((item) => item.source === "public-website" || item.type === "website");
  } else if (isAdmin && sourceFilter !== "all" && !requestedClientId) {
    requests = requests.filter((item) => item.source !== "public-website" && item.type !== "website");
  }
  if (isAdmin && !includeClosed) requests = requests.filter((item) => OPEN_STATUSES.has(item.status));
  requests.sort((a, b) => {
    const first = new Date(a.createdAt || 0).getTime();
    const second = new Date(b.createdAt || 0).getTime();
    return isAdmin ? first - second : second - first;
  });

  return NextResponse.json({ requests });
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  if (user.decodedToken.role === "admin") {
    return NextResponse.json({ error: "Administrators manage help requests from the Messages tab." }, { status: 403 });
  }

  const body = await request.json();
  const subject = trimmedText(body.subject);
  const message = trimmedText(body.message);
  const clientId = normalizeClientId(user.decodedToken.clientId);

  if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });
  if (body.selfHelpConfirmed !== true) {
    return NextResponse.json({ error: "Check the Docs or ask AI first, then confirm that you still need ARK support." }, { status: 400 });
  }
  if (subject.length < 4) return NextResponse.json({ error: "Add a short subject so ARK can identify the problem." }, { status: 400 });
  if (message.length < 10) return NextResponse.json({ error: "Describe what you need help with in at least 10 characters." }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "Keep the help request under 4,000 characters." }, { status: 400 });

  const db = getAdminDb();
  const [accountSnapshot, existingRequests] = await Promise.all([
    db.collection("accounts").doc(clientId).get(),
    systemCollection(db, "supportRequests").where("clientId", "==", clientId).get(),
  ]);
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  const billingState = computeBillingState(account);
  if (billingState.restricted) {
    return NextResponse.json(
      { error: "Help requests are unavailable while the account is payment-restricted. Update the payment method to restore full access." },
      { status: 402 },
    );
  }

  const alreadyOpen = existingRequests.docs.some((document) => {
    const data = document.data();
    return data.type === "help"
      && trimmedText(data.createdByUid) === user.decodedToken.uid
      && OPEN_STATUSES.has(ALLOWED_STATUSES.has(data.status) ? data.status : "new");
  });
  if (alreadyOpen) {
    return NextResponse.json({ error: "You already have an open help request. Check Help History for its status or ARK's reply." }, { status: 409 });
  }

  const ref = systemCollection(db, "supportRequests").doc();
  await ref.set({
    clientId,
    businessName: trimmedText(account.businessName || clientId),
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

  return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
}

export async function PATCH(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  if (user.decodedToken.role !== "admin") {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const body = await request.json();
  const id = trimmedText(body.id);
  const action = body.action === "reply" ? "reply" : "status";
  const status = ALLOWED_STATUSES.has(body.status) ? body.status : "";
  const adminNote = trimmedText(body.adminNote);
  const adminReply = trimmedText(body.adminReply);

  if (!id) return NextResponse.json({ error: "Choose a help request." }, { status: 400 });
  if (action === "reply" && adminReply.length < 2) return NextResponse.json({ error: "Write a reply before sending it." }, { status: 400 });
  if (adminReply.length > 2000) return NextResponse.json({ error: "Keep the reply under 2,000 characters." }, { status: 400 });
  if (action === "status" && !status) return NextResponse.json({ error: "Choose a request status." }, { status: 400 });
  if (status === "denied" && !adminNote) {
    return NextResponse.json({ error: "Add a short reason before denying the request." }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = systemCollection(db, "supportRequests").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });

  const current = snapshot.data();
  const isWebsiteRequest = current.type === "website" || trimmedText(current.source) === "public-website";
  if (action === "reply") {
    if (isWebsiteRequest) {
      return NextResponse.json({ error: "Use the visitor's email or phone number to answer a website request." }, { status: 400 });
    }
    await ref.set({
      adminReply,
      repliedBy: user.decodedToken.uid,
      repliedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    try {
      await sendRequestStatusNotification({
        db,
        clientId: normalizeClientId(current.clientId),
        requestId: id,
        subject: trimmedText(current.subject),
        status: "reply",
        adminNote: adminReply,
        recipientUid: trimmedText(current.createdByUid),
      });
    } catch (notificationError) {
      console.error("Help reply saved but customer notification failed", notificationError);
    }
    return NextResponse.json({ ok: true });
  }

  const currentStatus = ALLOWED_STATUSES.has(current.status) ? current.status : "new";
  if (!STATUS_TRANSITIONS[currentStatus]?.has(status)) {
    return NextResponse.json(
      { error: currentStatus === "new" ? "Start or deny this request first." : currentStatus === "in-progress" ? "Complete this request when the work is finished." : "This request is already closed." },
      { status: 409 },
    );
  }

  await ref.set({
    status,
    adminNote,
    updatedBy: user.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === "in-progress" ? { startedAt: FieldValue.serverTimestamp() } : {}),
    ...(status === "completed" ? { completedAt: FieldValue.serverTimestamp(), closedAt: FieldValue.serverTimestamp() } : {}),
    ...(status === "denied" ? { deniedAt: FieldValue.serverTimestamp(), closedAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });

  if (!isWebsiteRequest) {
    try {
      await sendRequestStatusNotification({
        db,
        clientId: normalizeClientId(current.clientId),
        requestId: id,
        subject: trimmedText(current.subject),
        status,
        adminNote,
        recipientUid: trimmedText(current.createdByUid),
      });
    } catch (notificationError) {
      console.error("Help request status saved but customer notification failed", notificationError);
    }
  }

  return NextResponse.json({ ok: true });
}
