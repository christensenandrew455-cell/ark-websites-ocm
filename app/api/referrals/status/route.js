import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { loadReferralStatus } from "../../../lib/referrals";
import { resolveBillingWindow } from "../../../lib/stripeUsageBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

export async function GET(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;
  try {
    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(auth.clientId).get();
    if (!accountSnapshot.exists) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    const account = accountSnapshot.data();
    const subscriptionId = text(account.stripeSubscriptionId);
    const timeZone = text(account.timeZone) || "America/New_York";
    let window;
    try {
      window = await resolveBillingWindow({
        stripe: process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null,
        subscriptionId,
        timeZone,
        strictSubscription: Boolean(subscriptionId && process.env.STRIPE_SECRET_KEY),
      });
    } catch (error) {
      console.warn("Unable to refresh referral billing period; using the last calculated period", error);
      const storedKey = text(account.currentBillingMonth);
      if (!storedKey) {
        window = await resolveBillingWindow({ stripe: null, subscriptionId: "", timeZone });
      } else {
        window = { monthKey: storedKey };
      }
    }
    return NextResponse.json({
      ok: true,
      ...(await loadReferralStatus({ db, clientId: auth.clientId, billingPeriodKey: window.monthKey })),
    });
  } catch (error) {
    console.error("Unable to load referral status", error);
    return NextResponse.json({ error: "Could not load referral savings right now." }, { status: 500 });
  }
}
