import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { publicCallPlanSummary } from "../../../lib/callPlanBilling";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  try {
    const db = getAdminDb();
    const snapshot = await db.collection("accounts").doc(authorization.clientId).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    const account = snapshot.data();
    return NextResponse.json({
      billingProvider: String(account.billingProvider || (account.appleOriginalTransactionId ? "apple" : "stripe")),
      ...publicCallPlanSummary(account),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to load monthly call plan", error);
    return NextResponse.json({ error: "Could not load the current call plan." }, { status: 500 });
  }
}
