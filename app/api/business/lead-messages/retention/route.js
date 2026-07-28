import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../lib/firebase-admin";
import { cleanupExpiredConversations, normalizeMessageRetentionDays } from "../../../../../lib/messageRetention";
import { requireUser } from "../../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (decoded.role !== "customer" || !clientId) return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  const db = getAdminDb();
  const [accountSnapshot, businessSnapshot] = await Promise.all([
    db.collection("accounts").doc(decoded.uid).get(),
    db.collection("businesses").doc(clientId).get(),
  ]);
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || !businessSnapshot.exists) return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  return { db, decoded, clientId, accountRef: accountSnapshot.ref, businessRef: businessSnapshot.ref, business: businessSnapshot.data() };
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  return NextResponse.json({ ok: true, retentionDays: normalizeMessageRetentionDays(access.business.messageRetentionDays) });
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const requested = Number(body.retentionDays || 0);
    const retentionDays = normalizeMessageRetentionDays(requested);
    if (retentionDays !== requested) return NextResponse.json({ error: "Choose Never, 1 day, 1 week, or 1 month." }, { status: 400 });

    const update = { messageRetentionDays: retentionDays, updatedAt: FieldValue.serverTimestamp() };
    await Promise.all([
      access.businessRef.set(update, { merge: true }),
      access.accountRef.set(update, { merge: true }),
      access.db.collection("ocmClients").doc(access.clientId).collection("settings").doc("account").set({ MessageRetentionDays: retentionDays, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);

    const deleted = await cleanupExpiredConversations(access.db, access.clientId, retentionDays);
    return NextResponse.json({ ok: true, retentionDays, deleted });
  } catch (error) {
    console.error("Unable to update message retention", error);
    return NextResponse.json({ error: "Could not update message auto-delete settings." }, { status: 500 });
  }
}
