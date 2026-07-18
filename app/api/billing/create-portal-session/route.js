import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const stripeKey = text(process.env.STRIPE_SECRET_KEY);
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
    }

    const db = getAdminDb();
    const [businessSnapshot, settingsSnapshot] = await Promise.all([
      db.collection("businesses").doc(auth.clientId).get(),
      db.collection("ocmClients").doc(auth.clientId).collection("settings").doc("account").get(),
    ]);

    const business = businessSnapshot.exists ? businessSnapshot.data() : {};
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
    const customerId = text(business.stripeCustomerId || settings.StripeCustomerId);

    if (!customerId) {
      return NextResponse.json(
        { error: "This account does not have a Stripe customer attached yet. Contact support before changing the card." },
        { status: 409 }
      );
    }

    const stripe = new Stripe(stripeKey);
    const appUrl = text(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    const configuration = text(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings`,
      ...(configuration ? { configuration } : {}),
    });

    return NextResponse.json({
      url: session.url,
      mode: stripeKey.startsWith("sk_live_") ? "live" : "test",
    });
  } catch (error) {
    console.error("Unable to create Stripe billing portal session", error);
    return NextResponse.json(
      { error: "Could not open secure billing settings. Check Stripe portal configuration and try again." },
      { status: 500 }
    );
  }
}
