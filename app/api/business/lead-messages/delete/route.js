import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function conversationId(clientId, collectionKey, leadId) { return createHash("sha256").update(`${clientId}:${collectionKey}:${leadId}`).digest("hex").slice(0, 48); }

async function deleteQuery(db, query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (decoded.role !== "customer" || !clientId) return NextResponse.json({ error: "An owner account is required." }, { status: 403 });

  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    const collectionKey = body.collectionKey === "clients" ? "clients" : "contactedMe";
    if (!leadId) return NextResponse.json({ error: "Choose a conversation to delete." }, { status: 400 });

    const db = getAdminDb();
    const [accountSnapshot, businessSnapshot] = await Promise.all([
      db.collection("accounts").doc(decoded.uid).get(),
      db.collection("businesses").doc(clientId).get(),
    ]);
    if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || !businessSnapshot.exists) return NextResponse.json({ error: "An active owner account is required." }, { status: 403 });

    const root = db.collection("ocmClients").doc(clientId);
    const key = conversationId(clientId, collectionKey, leadId);
    const conversationRef = root.collection("leadConversations").doc(key);
    const conversationSnapshot = await conversationRef.get();
    if (!conversationSnapshot.exists) return NextResponse.json({ error: "That conversation no longer exists." }, { status: 404 });

    await deleteQuery(db, conversationRef.collection("messages"));
    await deleteQuery(db, root.collection("telnyxMessageIndex").where("conversationId", "==", key));
    await conversationRef.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to delete lead conversation", error);
    return NextResponse.json({ error: "Could not delete the conversation." }, { status: 500 });
  }
}
