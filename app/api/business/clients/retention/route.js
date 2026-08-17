import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../../lib/accountRoles";
import { cleanupExpiredClients, normalizeClientRetentionDays } from "../../../../lib/clientRetention";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (!isStandardRole(decoded.role) || !clientId) {
    return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  }
  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").doc(clientId).get();
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || text(accountSnapshot.data().uid) !== text(decoded.uid)) {
    return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  }
  return {
    db,
    clientId,
    accountRef: accountSnapshot.ref,
    account: accountSnapshot.data(),
  };
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  return NextResponse.json({
    ok: true,
    retentionDays: normalizeClientRetentionDays(access.account.clientRetentionDays),
  });
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const requested = Number(body.retentionDays);
    const retentionDays = normalizeClientRetentionDays(requested);
    if (retentionDays !== requested) {
      return NextResponse.json({ error: "Choose never, 1 day, 1 week, or 1 month." }, { status: 400 });
    }

    await access.accountRef.set({
      clientRetentionDays: retentionDays,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const deleted = await cleanupExpiredClients(access.db, access.clientId, retentionDays);
    return NextResponse.json({ ok: true, retentionDays, deleted });
  } catch (error) {
    console.error("Unable to update client retention", error);
    return NextResponse.json({ error: "Could not update client auto-delete settings." }, { status: 500 });
  }
}
