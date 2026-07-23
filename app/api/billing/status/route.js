import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { publicBillingStatus, syncBillingState } from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const db = getAdminDb();
    const snapshot = await db.collection("businesses").doc(auth.clientId).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    const business = snapshot.data();
    const state = await syncBillingState(db, auth.clientId, business);
    return NextResponse.json({
      status: publicBillingStatus({
        ...business,
        billingPhase: state.phase,
        serviceAccess: state.serviceAccess,
        billingDeletionReviewRequired: state.phase === "deletion-review",
      }),
    });
  } catch (error) {
    console.error("Unable to load billing status", error);
    return NextResponse.json({ error: "Could not check the account payment status." }, { status: 500 });
  }
}
