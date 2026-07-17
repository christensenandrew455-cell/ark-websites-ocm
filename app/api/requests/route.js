import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../lib/firebase-admin";
import { requireUser } from "../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["help", "change"]);
const ALLOWED_STATUSES = new Set(["new", "in-progress", "completed", "denied"]);

function text(value) {
  return String(value || "").trim();
}

function cleanClientId(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function requestPayload(document) {
  const data = document.data();
  return {
    id: document.id,
    clientId: text(data.clientId),
    businessName: text(data.businessName),
    ownerName: text(data.ownerName),
    accountEmail: text(data.accountEmail),
    type: ALLOWED_TYPES.has(data.type) ? data.type : "change",
    subject: text(data.subject),
    message: text(data.message),
    status: ALLOWED_STATUSES.has(data.status) ? data.status : "new",
    adminNote: text(data.adminNote),
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}

export async function GET(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  const db = getAdminDb();
  const isAdmin = user.decodedToken.role === "admin";
  const clientId = cleanClientId(user.decodedToken.clientId);

  let snapshot;
  if (isAdmin) {
    snapshot = await db.collection("supportRequests").get();
  } else {
    if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });
    snapshot = await db.collection("supportRequests").where("clientId", "==", clientId).get();
  }

  const requests = snapshot.docs
    .map(requestPayload)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

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
  const subject = text(body.subject);
  const message = text(body.message);
  const clientId = cleanClientId(user.decodedToken.clientId);

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
  const ref = db.collection("supportRequests").doc();

  await ref.set({
    clientId,
    businessName: text(business.businessName || account.businessName || clientId),
    ownerName: text(account.ownerName || business.ownerName || user.decodedToken.name),
    accountEmail: text(account.accountEmail || user.decodedToken.email).toLowerCase(),
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
  const id = text(body.id);
  const status = ALLOWED_STATUSES.has(body.status) ? body.status : "";
  const adminNote = text(body.adminNote);

  if (!id || !status) return NextResponse.json({ error: "Choose a request and status." }, { status: 400 });

  const ref = getAdminDb().collection("supportRequests").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });

  await ref.set({
    status,
    adminNote,
    updatedBy: user.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === "completed" || status === "denied" ? { closedAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });

  return NextResponse.json({ ok: true });
}
