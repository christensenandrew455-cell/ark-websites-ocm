import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../lib/accountRoles";
import { getAdminDb } from "../../../lib/firebase-admin";
import { leadContactFieldDeletionPatch, stripLeadContactFields } from "../../../lib/leadContactFields";
import { pendingLeadSummary } from "../../../lib/leadVisibility";
import { requireUser } from "../../../lib/userRequest";
import { normalizeClientId, serializeFirestoreValue } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READABLE_ACCOUNT_STATUSES = new Set(["active", "disabled"]);
const EDITABLE_COLLECTIONS = new Set(["contactedMe", "clients"]);

function text(value, maximum = 4_000) {
  return String(value || "").trim().slice(0, maximum);
}

function leadDocuments(snapshot, collectionKey) {
  return snapshot.docs.map((document) => {
    const data = stripLeadContactFields(serializeFirestoreValue(document.data()));
    if (collectionKey === "contactedMe") return pendingLeadSummary(document.id, data);
    return { id: document.id, collectionKey, ...data };
  });
}

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };

  const decodedToken = user.decodedToken;
  const clientId = normalizeClientId(decodedToken.clientId);
  if (!isStandardRole(decodedToken.role) || !clientId) {
    return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  }

  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(clientId);
  const accountSnapshot = await accountRef.get();
  const account = accountSnapshot.exists ? accountSnapshot.data() : null;
  if (!account || !isStandardRole(account.role) || text(account.uid) !== text(decodedToken.uid) || !READABLE_ACCOUNT_STATUSES.has(text(account.status))) {
    return { response: NextResponse.json({ error: "This owner account is not available." }, { status: 403 }) };
  }

  return { db, account, accountRef, clientId };
}

export async function GET(request) {
  try {
    const access = await authorizeOwner(request);
    if (access.response) return access.response;

    const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
    if (summaryOnly) {
      const [contactedCount, clientCount] = await Promise.all([
        access.accountRef.collection("contactedMe").count().get(),
        access.accountRef.collection("clients").count().get(),
      ]);
      return NextResponse.json({
        contactedCount: Number(contactedCount.data().count || 0),
        clientCount: Number(clientCount.data().count || 0),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const [contactedSnapshot, clientsSnapshot] = await Promise.all([
      access.accountRef.collection("contactedMe").get(),
      access.accountRef.collection("clients").get(),
    ]);
    const summary = {
      contactedCount: contactedSnapshot.size,
      clientCount: clientsSnapshot.size,
    };

    return NextResponse.json(
      {
        ...summary,
        contacted: leadDocuments(contactedSnapshot, "contactedMe"),
        clients: leadDocuments(clientsSnapshot, "clients"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load owner leads", error);
    return NextResponse.json({ error: "Could not load leads." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const access = await authorizeOwner(request);
    if (access.response) return access.response;
    if (access.account.status !== "active") {
      return NextResponse.json({ error: "Restore the account before editing client information." }, { status: 402 });
    }

    const body = await request.json();
    const leadId = text(body.leadId, 300);
    const collectionKey = text(body.collectionKey, 40);
    if (!leadId || leadId.includes("/") || !EDITABLE_COLLECTIONS.has(collectionKey)) {
      return NextResponse.json({ error: "Choose a valid client record." }, { status: 400 });
    }

    const reference = access.accountRef.collection(collectionKey).doc(leadId);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "That client record is no longer available." }, { status: 404 });
    }

    const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields : {};
    const update = {
      Name: text(fields.Name, 160),
      Phone: text(fields.Phone, 40),
      Address: text(fields.Address, 300),
      Job: text(fields.Job, 180),
      EstimateDate: text(fields.EstimateDate, 40),
      EstimateTime: text(fields.EstimateTime, 40),
      ClientNotes: text(fields.ClientNotes),
      BusinessNotes: text(fields.BusinessNotes),
      Notes: text(fields.ClientNotes),
      PreferredDate: text(fields.EstimateDate, 40),
      PreferredTime: text(fields.EstimateTime, 40),
      ...leadContactFieldDeletionPatch(FieldValue.delete()),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await reference.set(update, { merge: true });
    const updated = await reference.get();
    return NextResponse.json({
      ok: true,
      record: {
        id: updated.id,
        collectionKey,
        ...stripLeadContactFields(serializeFirestoreValue(updated.data())),
      },
    });
  } catch (error) {
    console.error("Unable to update owner lead", error);
    return NextResponse.json({ error: "Could not save the client information." }, { status: 500 });
  }
}
