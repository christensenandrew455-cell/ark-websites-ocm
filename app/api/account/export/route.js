import { NextResponse } from "next/server";
import { readAccountSections } from "../../../lib/accountSections";
import { computeBillingState } from "../../../lib/billingDelinquency";
import { getAdminDb } from "../../../lib/firebase-admin";
import { systemCollection } from "../../../lib/firestoreLayout";
import { stripLeadContactFields } from "../../../lib/leadContactFields";
import { pendingLeadSummary } from "../../../lib/leadVisibility";
import { requireUser } from "../../../lib/userRequest";
import { normalizeClientId, serializeFirestoreValue } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function documents(snapshot) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...serializeFirestoreValue(document.data()),
  }));
}

function leadDocuments(snapshot, collectionKey) {
  return snapshot.docs.map((document) => {
    const data = stripLeadContactFields(serializeFirestoreValue(document.data()));
    if (collectionKey === "contactedMe") return pendingLeadSummary(document.id, data);
    return { id: document.id, ...data };
  });
}

function accountSummary(data = {}) {
  return {
    businessName: data.businessName || data.BusinessName || "",
    ownerName: data.ownerName || data.OwnerName || "",
    accountEmail: data.accountEmail || data.AccountEmail || "",
    accountPhone: data.accountPhone || data.AccountPhone || "",
    status: data.status || "",
    createdAt: serializeFirestoreValue(data.createdAt),
    updatedAt: serializeFirestoreValue(data.updatedAt),
  };
}

export async function GET(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  const clientId = normalizeClientId(user.decodedToken.clientId);
  if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });

  try {
    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(clientId);
    const [accountSnapshot, contactedSnapshot, clientsSnapshot, requestsSnapshot] = await Promise.all([
      accountRef.get(),
      accountRef.collection("contactedMe").get(),
      accountRef.collection("clients").get(),
      systemCollection(db, "supportRequests").where("clientId", "==", clientId).get(),
    ]);

    const sections = accountSnapshot.exists ? await readAccountSections(accountSnapshot) : null;
    const account = sections?.account || {};
    if (computeBillingState(account).restricted) {
      return NextResponse.json({ error: "Client-data downloads are unavailable while the account is payment-restricted." }, { status: 402 });
    }

    const payload = {
      exportVersion: "1.3",
      exportedAt: new Date().toISOString(),
      clientId,
      account: accountSummary(account),
      businessInformation: serializeFirestoreValue(sections?.business || {}),
      customization: serializeFirestoreValue(sections?.customization || {}),
      contactedMe: leadDocuments(contactedSnapshot, "contactedMe"),
      clients: leadDocuments(clientsSnapshot, "clients"),
      requests: documents(requestsSnapshot),
    };
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${clientId}-client-data-${date}.json`;

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Unable to export customer data", error);
    return NextResponse.json({ error: "Client data could not be prepared right now." }, { status: 500 });
  }
}
