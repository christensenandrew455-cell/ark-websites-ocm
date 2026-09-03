import { NextResponse } from "next/server";
import { readAccountSections } from "../../lib/accountSections";
import { requireAuthenticatedCustomer } from "../../lib/authenticatedRequest";
import { getAdminDb } from "../../lib/firebase-admin";
import { publicRewardSummary, referralPeriodRef } from "../../lib/rewardLeadCredits";
import { calendarMonthWindow } from "../../lib/timeWindows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  try {
    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(authorization.clientId).get();
    if (!accountSnapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    const sections = await readAccountSections(accountSnapshot);
    const month = calendarMonthWindow(sections?.business?.timeZone, new Date());
    const periodSnapshot = await referralPeriodRef(db, authorization.clientId, month.monthKey).get();
    const period = periodSnapshot.exists ? periodSnapshot.data() : {};
    return NextResponse.json({
      referralCode: authorization.clientId,
      businessName: String(sections?.account?.businessName || authorization.clientId),
      ...publicRewardSummary(sections?.account, period, month.monthKey),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to load rewards", error);
    return NextResponse.json({ error: "Rewards could not be loaded right now." }, { status: 500 });
  }
}
