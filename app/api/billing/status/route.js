import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/userRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { publicBillingStatus } from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  try {
    const db = getAdminDb();
    const snapshot = await db.collection("accounts").doc(auth.clientId).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    return NextResponse.json({ status: publicBillingStatus(snapshot.data()) });
  } catch (error) {
    console.error("Unable to load billing status", error);
    return NextResponse.json({ error: "Could not check the account payment status." }, { status: 500 });
  }
}
