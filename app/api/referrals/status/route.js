import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { loadReferralStatus } from "../../../lib/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;
  try {
    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(auth.clientId).get();
    if (!accountSnapshot.exists) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      ...(await loadReferralStatus({ db, clientId: auth.clientId })),
    });
  } catch (error) {
    console.error("Unable to load referral status", error);
    return NextResponse.json({ error: "Could not load referral savings right now." }, { status: 500 });
  }
}
