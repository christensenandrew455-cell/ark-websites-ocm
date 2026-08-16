import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../lib/accountRoles";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_MESSAGE, availableAccountFeatures } from "../../../lib/launchFeatures";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  if (!isStandardRole(decoded.role) || !decoded.clientId) return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(decoded.uid);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active") return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  return { db, decoded, accountRef, account: accountSnapshot.data(), clientId: String(decoded.clientId) };
}

function realConversationCount(snapshot) {
  return snapshot.docs.filter((document) => {
    const data = document.data();
    return Boolean(String(data.leadId || "").trim() || String(data.lastMessage || "").trim() || data.lastMessageAt || data.createdAt);
  }).length;
}

async function featureState(db, clientId, source = {}) {
  const conversationsSnapshot = await db.collection("ocmClients").doc(clientId).collection("leadConversations").get();
  const conversationCount = realConversationCount(conversationsSnapshot);
  return {
    ...availableAccountFeatures(source),
    conversationCount,
    canDisableMessages: conversationCount === 0,
  };
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  const businessSnapshot = await access.db.collection("businesses").doc(access.clientId).get();
  return NextResponse.json({ ok: true, ...(await featureState(access.db, access.clientId, businessSnapshot.exists ? businessSnapshot.data() : access.account)) });
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    if (!MESSAGES_AVAILABLE && body.messagesEnabled === true) return NextResponse.json({ error: UPCOMING_FEATURE_MESSAGE }, { status: 409 });
    const messagesEnabled = MESSAGES_AVAILABLE && body.messagesEnabled === true;
    const businessRef = access.db.collection("businesses").doc(access.clientId);
    const root = access.db.collection("ocmClients").doc(access.clientId);
    const [businessSnapshot, conversationsSnapshot] = await Promise.all([
      businessRef.get(),
      root.collection("leadConversations").get(),
    ]);
    const current = availableAccountFeatures(businessSnapshot.exists ? businessSnapshot.data() : access.account);
    const conversationCount = realConversationCount(conversationsSnapshot);
    if (current.messagesEnabled && !messagesEnabled && conversationCount > 0) {
      return NextResponse.json({ error: `Delete all ${conversationCount} conversation${conversationCount === 1 ? "" : "s"} before turning Messages off.` }, { status: 409 });
    }

    const update = { messagesEnabled, updatedAt: FieldValue.serverTimestamp() };
    const batch = access.db.batch();
    batch.set(businessRef, update, { merge: true });
    batch.set(access.accountRef, update, { merge: true });
    batch.set(root.collection("settings").doc("account"), { MessagesEnabled: messagesEnabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();

    const auth = getAdminAuth();
    const ownerRecord = await auth.getUser(access.decoded.uid);
    await auth.setCustomUserClaims(access.decoded.uid, { ...(ownerRecord.customClaims || {}), messagesEnabled });
    return NextResponse.json({ ok: true, messagesEnabled, conversationCount, canDisableMessages: conversationCount === 0 });
  } catch (error) {
    console.error("Unable to update account features", error);
    return NextResponse.json({ error: "Could not update account features." }, { status: 500 });
  }
}
