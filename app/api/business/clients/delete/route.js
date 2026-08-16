import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../../lib/accountRoles";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function conversationId(clientId, collectionKey, leadId) {
  return createHash("sha256")
    .update(`${clientId}:${collectionKey}:${leadId}`)
    .digest("hex")
    .slice(0, 48);
}

async function deleteQuery(db, query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

async function deleteConversation(db, root, clientId, collectionKey, leadId) {
  const key = conversationId(clientId, collectionKey, leadId);
  const conversationRef = root.collection("leadConversations").doc(key);
  await deleteQuery(db, conversationRef.collection("messages"));
  await deleteQuery(db, root.collection("telnyxMessageIndex").where("conversationId", "==", key));
  await conversationRef.delete();
}

async function deleteLeadConversations(db, root, leadId) {
  const snapshot = await root.collection("leadConversations").where("leadId", "==", leadId).get();
  for (const document of snapshot.docs) {
    await deleteQuery(db, document.ref.collection("messages"));
    await deleteQuery(db, root.collection("telnyxMessageIndex").where("conversationId", "==", document.id));
    await document.ref.delete();
  }
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (!isStandardRole(decoded.role) || !clientId) {
    return NextResponse.json({ error: "An owner account is required." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    const collectionKey = ["contactedMe", "preClients", "clients", "postClients"].includes(body.collectionKey)
      ? body.collectionKey
      : "clients";

    if (!leadId) {
      return NextResponse.json({ error: "Choose a client to delete." }, { status: 400 });
    }

    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(clientId).get();
    if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || text(accountSnapshot.data().uid) !== text(decoded.uid)) {
      return NextResponse.json({ error: "An active owner account is required." }, { status: 403 });
    }

    const root = db.collection("accounts").doc(clientId);
    const recordRef = root.collection(collectionKey).doc(leadId);
    const recordSnapshot = await recordRef.get();
    if (!recordSnapshot.exists) {
      return NextResponse.json({ error: "That client no longer exists." }, { status: 404 });
    }

    await deleteLeadConversations(db, root, leadId);

    const conversationCollections = collectionKey === "contactedMe"
      ? ["contactedMe"]
      : [collectionKey, "clients", "contactedMe"];

    for (const key of new Set(conversationCollections)) {
      await deleteConversation(db, root, clientId, key, leadId);
    }

    await deleteQuery(db, root.collection("telnyxMessageIndex").where("leadId", "==", leadId));
    await recordRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to delete client and related messaging data", error);
    return NextResponse.json({ error: "Could not delete the client." }, { status: 500 });
  }
}
