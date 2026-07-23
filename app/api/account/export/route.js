import { NextResponse } from "next/server";
import { computeBillingState } from "../../../lib/billingDelinquency";
import { getAdminDb } from "../../../lib/firebase-admin";
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
  if (user.decodedToken.role === "admin") {
    return NextResponse.json({ error: "Use a customer account to download that customer’s data." }, { status: 403 });
  }

  const clientId = normalizeClientId(user.decodedToken.clientId);
  if (!clientId) return NextResponse.json({ error: "This account has no business assigned." }, { status: 400 });

  try {
    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(clientId);
    const clientRoot = db.collection("ocmClients").doc(clientId);
    const [businessSnapshot, settingsSnapshot, contactedSnapshot, clientsSnapshot, requestsSnapshot] = await Promise.all([
      businessRef.get(),
      clientRoot.collection("settings").doc("account").get(),
      clientRoot.collection("contactedMe").get(),
      clientRoot.collection("clients").get(),
      db.collection("supportRequests").where("clientId", "==", clientId).get(),
    ]);

    const business = businessSnapshot.exists ? businessSnapshot.data() : {};
    if (computeBillingState(business).restricted) {
      return NextResponse.json({ error: "Client-data downloads are unavailable while the account is payment-restricted." }, { status: 402 });
    }

    const payload = {
      exportVersion: "1.0",
      exportedAt: new Date().toISOString(),
      clientId,
      account: accountSummary(business),
      settings: settingsSnapshot.exists ? accountSummary(settingsSnapshot.data()) : {},
      contactedMe: documents(contactedSnapshot),
      clients: documents(clientsSnapshot),
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
