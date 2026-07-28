import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTIONS = [0, 1, 7, 30];
function text(value) { return String(value || "").trim(); }
function normalize(value) { const days = Number(value); return OPTIONS.includes(days) ? days : 0; }
function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

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
  return { db, clientId, accountRef: accountSnapshot.ref, businessRef: businessSnapshot.ref, business: businessSnapshot.data() };
}

async function cleanupExpiredLeads(db, clientId, retentionDays, now = Date.now()) {
  if (retentionDays === 0) return 0;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const root = db.collection("ocmClients").doc(clientId);
  let deleted = 0;
  for (const collectionKey of ["contactedMe", "clients"]) {
    const snapshot = await root.collection(collectionKey).get();
    for (const document of snapshot.docs) {
      const data = document.data();
      const activityAt = toMillis(data.updatedAt || data.acceptedAt || data.createdAt || data.contactedAt);
      if (!activityAt || activityAt >= cutoff) continue;
      await document.ref.delete();
      deleted += 1;
    }
  }
  return deleted;
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  return NextResponse.json({ ok: true, retentionDays: normalize(access.business.leadRetentionDays) });
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const requested = Number(body.retentionDays);
    const retentionDays = normalize(requested);
    if (retentionDays !== requested) return NextResponse.json({ error: "Choose never, 1 day, 1 week, or 1 month." }, { status: 400 });
    const update = { leadRetentionDays: retentionDays, updatedAt: FieldValue.serverTimestamp() };
    await Promise.all([
      access.businessRef.set(update, { merge: true }),
      access.accountRef.set(update, { merge: true }),
      access.db.collection("ocmClients").doc(access.clientId).collection("settings").doc("account").set({ LeadRetentionDays: retentionDays, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    const deleted = await cleanupExpiredLeads(access.db, access.clientId, retentionDays);
    return NextResponse.json({ ok: true, retentionDays, deleted });
  } catch (error) {
    console.error("Unable to update lead retention", error);
    return NextResponse.json({ error: "Could not update lead auto-delete settings." }, { status: 500 });
  }
}
