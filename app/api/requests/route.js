import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { computeBillingState } from "../../lib/billingDelinquency";
import { getAdminDb } from "../../lib/firebase-admin";
import { sendRequestStatusNotification } from "../../lib/notificationService";
import { requireUser } from "../../lib/userRequest";
import { normalizeClientId, toIsoString, trimmedText } from "../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["help", "change"]);
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
  return {
    id: document.id,
    clientId: trimmedText(data.clientId),
    businessName: trimmedText(data.businessName),
    ownerName: trimmedText(data.ownerName),
    accountEmail: trimmedText(data.accountEmail),
    type: ALLOWED_TYPES.has(data.type) ? data.type : "change",
    subject: trimmedText(data.subject),
    message: trimmedText(data.message),
    status: ALLOWED_STATUSES.has(data.status) ? data.status : "new",
    adminNote: trimmedText(data.adminNote),
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

  let snapshot;
  if (isAdmin) {
    snapshot = requestedClientId
      ? await db.collection("supportRequests").where("clientId", "==", requestedClientId).get()
      : await db.collection("supportRequests").get();
  } else {
    if (!tokenClientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });
    snapshot = await db.collection("supportRequests").where("clientId", "==", tokenClientId).get();
  }

  let requests = snapshot.docs.map(requestPayload);
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
    return NextResponse.json({ error: "Administrators manage requests from the Messages tab." }, { status: 403 });
  }

  const body = await request.json();
  const type = ALLOWED_TYPES.has(body.type) ? body.type : "";
  const subject = trimmedText(body.subject);
  const message = trimmedText(body.message);
  const clientId = normalizeClientId(user.decodedToken.clientId);

  if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });
  if (!type) return NextResponse.json({ error: "Choose Help or Change." }, { status: 400 });
  if (message.length < 10) return NextResponse.json({ error: "Describe the request in at least 10 characters." }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "Keep the request under 4,000 characters." }, { status: 400 });

  const db = getAdminDb();
  const [businessSnapshot, accountSnapshot] = await Promise.all([
    db.collection("businesses").doc(clientId).get(),
    db.collection("accounts").doc(user.decodedToken.uid).get(),
  ]);
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  const billingState = computeBillingState(business);
  if (billingState.restricted) {
    return NextResponse.json(
      { error: "Help and change requests are unavailable while the account is payment-restricted. Update the payment method to restore full access." },
      { status: 402 }
    );
  }

  const ref = db.collection("supportRequests").doc();
  await ref.set({
    clientId,
    businessName: trimmedText(business.businessName || account.businessName || clientId),
    ownerName: trimmedText(account.ownerName || business.ownerName || user.decodedToken.name),
    accountEmail: trimmedText(account.accountEmail || user.decodedToken.email).toLowerCase(),
    type,
    subject: subject || (type === "help" ? "Urgent help request" : "Receptionist change request"),
    message,
    status: "new",
    priority: type === "help" ? "urgent" : "normal",
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
  const status = ALLOWED_STATUSES.has(body.status) ? body.status : "";
  const adminNote = trimmedText(body.adminNote);

  if (!id || !status) return NextResponse.json({ error: "Choose a request and status." }, { status: 400 });
  if (status === "denied" && !adminNote) {
    return NextResponse.json({ error: "Add a short reason before denying the request." }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.collection("supportRequests").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });

  const current = snapshot.data();
  const currentStatus = ALLOWED_STATUSES.has(current.status) ? current.status : "new";
  if (!STATUS_TRANSITIONS[currentStatus]?.has(status)) {
    return NextResponse.json(
      { error: currentStatus === "new" ? "Start or deny this request first." : currentStatus === "in-progress" ? "Complete this request when the work is finished." : "This request is already closed." },
      { status: 409 }
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

  try {
    await sendRequestStatusNotification({
      db,
      clientId: normalizeClientId(current.clientId),
      requestId: id,
      subject: trimmedText(current.subject),
      status,
      adminNote,
    });
  } catch (notificationError) {
    console.error("Request status saved but customer notification failed", notificationError);
  }

  return NextResponse.json({ ok: true });
}
