import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL } from "../../../lib/launchFeatures";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

async function authorizeOwner(request) {
  if (!MESSAGES_AVAILABLE) return { response: NextResponse.json({ error: `Messages are ${UPCOMING_FEATURE_LABEL.toLowerCase()}.` }, { status: 403 }) };
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (decoded.role !== "customer" || !clientId) {
    return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  }
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(decoded.uid);
  const businessRef = db.collection("businesses").doc(clientId);
  const [accountSnapshot, businessSnapshot] = await Promise.all([accountRef.get(), businessRef.get()]);
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || !businessSnapshot.exists) {
    return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  }
  return { db, decoded, clientId, accountRef, businessRef, business: businessSnapshot.data() };
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  return NextResponse.json({
    ok: true,
    enabled: access.business.clientDeclineNoticeEnabled !== false,
  });
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const enabled = body.enabled === true;
    const update = {
      clientDeclineNoticeEnabled: enabled,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const batch = access.db.batch();
    batch.set(access.businessRef, update, { merge: true });
    batch.set(access.accountRef, update, { merge: true });
    batch.set(
      access.db.collection("ocmClients").doc(access.clientId).collection("settings").doc("account"),
      { ClientDeclineNoticeEnabled: enabled, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
    return NextResponse.json({ ok: true, enabled });
  } catch (error) {
    console.error("Unable to update client decline notice setting", error);
    return NextResponse.json({ error: "Could not update the client decline notice setting." }, { status: 500 });
  }
}
