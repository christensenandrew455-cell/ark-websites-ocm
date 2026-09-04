import { NextResponse } from "next/server";
import { readAccountSections } from "../../lib/accountSections";
import { requireUser } from "../../lib/userRequest";
import { getAdminDb } from "../../lib/firebase-admin";
import { publicReferralRewardSummary } from "../../lib/referralRewards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization.response;
  try {
    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(authorization.clientId).get();
    if (!accountSnapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    const sections = await readAccountSections(accountSnapshot);
    const summary = publicReferralRewardSummary(sections?.account);
    return NextResponse.json({
      ...(summary.referralRewardAvailable ? {
        referralCode: authorization.clientId,
        businessName: String(sections?.account?.businessName || authorization.clientId),
      } : {}),
      ...summary,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to load rewards", error);
    return NextResponse.json({ error: "Rewards could not be loaded right now." }, { status: 500 });
  }
}
