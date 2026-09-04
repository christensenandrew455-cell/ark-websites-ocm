import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminDb } from "../../../lib/firebase-admin";
import { retryPendingStripeReferralRewards } from "../../../lib/referralRewards";
import { syncRevenueLedger } from "../../../lib/revenueLedger";
import { refreshStoredPaymentMethod } from "../../../lib/stripePlanBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) { return String(value || "").trim(); }
function authorized(request) {
  const secret = text(process.env.CRON_SECRET);
  return Boolean(secret) && text(request.headers.get("authorization")) === `Bearer ${secret}`;
}

async function refreshStripePaymentMethods(db, stripe) {
  const snapshot = await db.collection("accounts").where("billingProvider", "==", "stripe").limit(100).get();
  const results = [];
  for (const document of snapshot.docs) {
    const account = document.data();
    const clientId = text(account.clientId);
    const customerId = text(account.stripeCustomerId);
    if (text(account.billingProvider) === "apple" || !clientId || !customerId) continue;
    try {
      const refreshed = await refreshStoredPaymentMethod({
        stripe,
        db,
        clientId,
        uid: document.id,
        customerId,
        subscriptionId: text(account.stripeSubscriptionId),
        fallbackPaymentMethodId: text(account.stripePaymentMethodId),
      });
      results.push({ uid: document.id, refreshed: Boolean(refreshed.paymentMethodId) });
    } catch (error) {
      results.push({ uid: document.id, refreshed: false, error: text(error?.message) });
    }
  }
  return results;
}

async function handle(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized. Configure CRON_SECRET and send it as a bearer token." }, { status: 401 });
  const db = getAdminDb();
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  if (!stripe) return NextResponse.json({ ok: false, error: "Stripe billing is not configured." }, { status: 503 });

  const [paymentMethods, rewardResults, revenue] = await Promise.all([
    refreshStripePaymentMethods(db, stripe),
    retryPendingStripeReferralRewards({ db, stripe }),
    syncRevenueLedger({ db, stripe, force: true }),
  ]);
  const referralRewards = {
    checked: rewardResults.length,
    credited: rewardResults.filter((result) => result.credited === true).length,
  };
  return NextResponse.json({ ok: true, paymentMethods, referralRewards, revenue });
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
