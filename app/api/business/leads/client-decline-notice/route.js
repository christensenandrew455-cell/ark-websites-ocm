import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { requireUser } from "../../../../lib/userRequest";

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

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (decoded.role !== "customer" || !clientId) {
    return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  }
  const db = getAdminDb();
  const [accountSnapshot, businessSnapshot] = await Promise.all([
    db.collection("accounts").doc(decoded.uid).get(),
    db.collection("businesses").doc(clientId).get(),
  ]);
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || !businessSnapshot.exists) {
    return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  }
  return { db, decoded, clientId, business: businessSnapshot.data() };
}

async function businessPhone(db, clientId) {
  const [connectionSnapshot, receptionistSnapshot] = await Promise.all([
    db.collection("connections").doc(clientId).get(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist").get(),
  ]);
  const connection = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const receptionist = receptionistSnapshot.exists ? receptionistSnapshot.data() : {};
  return normalizePhone(
    connection.receptionistPhoneNormalized
      || receptionist.receptionistPhoneNormalized
      || connection.receptionistPhone
      || receptionist.receptionistPhone,
  );
}

async function sendText({ from, to, message }) {
  const apiKey = text(process.env.TELNYX_API_KEY);
  if (!apiKey || !from) return { ok: false, status: "provider-not-configured", error: "The business messaging number is not configured." };
  try {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, text: message }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    const providerMessageId = text(result?.data?.id || result?.id);
    const firstError = Array.isArray(result?.errors) ? result.errors[0] : Array.isArray(result?.data?.errors) ? result.data.errors[0] : null;
    const error = text(firstError?.detail || firstError?.title || result?.error);
    return { ok: response.ok, status: response.ok ? "sent" : "provider-error", providerMessageId, error };
  } catch (error) {
    return { ok: false, status: "provider-error", providerMessageId: "", error: text(error.message) };
  }
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    const phone = normalizePhone(body.phone);
    const leadName = text(body.name);
    if (!leadId) return NextResponse.json({ error: "A lead is required." }, { status: 400 });

    const root = access.db.collection("ocmClients").doc(access.clientId);
    const acceptedSnapshot = await root.collection("clients").doc(leadId).get();
    if (acceptedSnapshot.exists) return NextResponse.json({ ok: true, skipped: "accepted" });
    if (access.business.clientDeclineNoticeEnabled === false) return NextResponse.json({ ok: true, skipped: "disabled" });
    if (!phone) return NextResponse.json({ ok: true, skipped: "missing-phone" });

    const noticeRef = root.collection("clientDeclineNotices").doc(leadId);
    const reserved = await access.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(noticeRef);
      if (existing.exists && ["sending", "sent"].includes(text(existing.data().status))) return false;
      transaction.set(noticeRef, {
        leadId,
        leadName: leadName || null,
        phone,
        status: "sending",
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: existing.exists ? existing.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!reserved) return NextResponse.json({ ok: true, duplicate: true });

    const from = await businessPhone(access.db, access.clientId);
    const businessName = text(access.business.businessName || access.business.name) || "the business";
    const message = `We're sorry, but your estimate request has been declined by ${businessName}.`;
    const delivery = await sendText({ from, to: phone, message });
    await noticeRef.set({
      status: delivery.ok ? "sent" : "failed",
      message,
      fromPhone: from || null,
      providerMessageId: delivery.providerMessageId || null,
      providerError: delivery.error || null,
      sentAt: delivery.ok ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true, sent: delivery.ok, status: delivery.status, error: delivery.ok ? null : delivery.error || null });
  } catch (error) {
    console.error("Unable to send client decline notice", error);
    return NextResponse.json({ error: "Could not send the client decline notice." }, { status: 500 });
  }
}
