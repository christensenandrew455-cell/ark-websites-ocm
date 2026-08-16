import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { completeOwnerPaymentSetup } from "../../../lib/ownerPaymentSetup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function paymentFailure() {
  return "Your payment setup could not be completed. Update your payment method or try again.";
}

export async function POST(request) {
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: paymentFailure() }, { status: 503 });
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: paymentFailure() }, { status: 401 });

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(token, true);
    const { setupIntentId } = await request.json().catch(() => ({}));
    const result = await completeOwnerPaymentSetup({
      db: getAdminDb(),
      auth,
      stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
      uid: decoded.uid,
      setupIntentId,
    });
    return NextResponse.json({
      status: result.status,
      message: "account set up complete",
      nextPath: result.nextPath || "/",
    });
  } catch (error) {
    console.error("Unable to verify Stripe payment-method setup", error);
    return NextResponse.json({ error: paymentFailure() }, { status: 400 });
  }
}
