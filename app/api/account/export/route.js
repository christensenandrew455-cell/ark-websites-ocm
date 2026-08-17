import { NextResponse } from "next/server";
import { computeBillingState } from "../../../lib/billingDelinquency";
import { getAdminDb } from "../../../lib/firebase-admin";
import { systemCollection } from "../../../lib/firestoreLayout";
import { stripLeadContactFields } from "../../../lib/leadContactFields";
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

function leadDocuments(snapshot) {
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...stripLeadContactFields(serializeFirestoreValue(document.data())),
  }));
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

    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    if (computeBillingState(account).restricted) {
      return NextResponse.json({ error: "Client-data downloads are unavailable while the account is payment-restricted." }, { status: 402 });
    }

    const payload = {
      exportVersion: "1.1",
      exportedAt: new Date().toISOString(),
      clientId,
      account: accountSummary(account),
      settings: serializeFirestoreValue(account),
      contactedMe: leadDocuments(contactedSnapshot),
      clients: leadDocuments(clientsSnapshot),
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
