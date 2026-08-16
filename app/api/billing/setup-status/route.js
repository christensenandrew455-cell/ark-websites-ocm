import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { completeOwnerPaymentSetup } from "../../../lib/ownerPaymentSetup";
import { deletePendingOwnerSignup } from "../../../lib/pendingOwnerSignup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function paymentFailure() {
  return "Your payment setup could not be completed. Update your payment method or try again.";
}

function cardWasDeclined(error) {
  const values = [
    error?.code,
    error?.decline_code,
    error?.raw?.code,
    error?.raw?.decline_code,
    error?.payment_intent?.last_payment_error?.code,
    error?.payment_intent?.last_payment_error?.decline_code,
  ].map(text);
  return values.some((value) => value === "card_declined" || Boolean(value && value.includes("declin")));
}

export async function POST(request) {
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: paymentFailure() }, { status: 503 });
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: paymentFailure() }, { status: 401 });

  const auth = getAdminAuth();
  const db = getAdminDb();
  let uid = "";
  try {
    const decoded = await auth.verifyIdToken(token, true);
    uid = text(decoded.uid);
    const { setupIntentId } = await request.json().catch(() => ({}));
    const result = await completeOwnerPaymentSetup({
      db,
      auth,
      stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
      uid,
      setupIntentId,
    });
    return NextResponse.json({
      status: result.status,
      message: "account set up complete",
      nextPath: result.nextPath || "/",
    });
  } catch (error) {
    console.error("Unable to verify Stripe payment-method setup", error);
    if (uid && cardWasDeclined(error)) {
      try {
        await deletePendingOwnerSignup({ db, auth, uid });
      } catch (cleanupError) {
        console.error("Unable to remove a declined temporary signup", cleanupError);
        return NextResponse.json({ error: paymentFailure() }, { status: 500 });
      }
      return NextResponse.json({
        error: "The card was declined, so this temporary signup was removed. Start again with a different card.",
        signupCanceled: true,
        nextPath: "/signup",
      }, { status: 402 });
    }
    return NextResponse.json({ error: paymentFailure() }, { status: 400 });
  }
}
