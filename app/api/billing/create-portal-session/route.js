import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { ensureStripeBillingPortalConfiguration, missingStripeResource } from "../../../lib/stripePlanBilling";

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
    const accountSnapshot = await db.collection("accounts").doc(auth.clientId).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    if (text(account.billingProvider) === "apple") {
      return NextResponse.json({ error: "Manage this subscription through Apple." }, { status: 409 });
    }
    const customerId = text(account.stripeCustomerId);

    if (!customerId) {
      return NextResponse.json(
        { error: "This account does not have a Stripe customer attached yet. Contact support before changing the card." },
        { status: 409 }
      );
    }

    const stripe = new Stripe(stripeKey);
    const appUrl = text(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer?.deleted) throw new Error("STRIPE_CUSTOMER_DELETED");
    } catch (error) {
      if (!missingStripeResource(error) && text(error?.message) !== "STRIPE_CUSTOMER_DELETED") throw error;
      return NextResponse.json(
        { error: "The saved billing account could not be found. Contact support so ARK can reconnect it." },
        { status: 409 }
      );
    }
    const configuration = await ensureStripeBillingPortalConfiguration({ stripe, appUrl });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings?section=payment`,
      configuration: configuration.id,
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
