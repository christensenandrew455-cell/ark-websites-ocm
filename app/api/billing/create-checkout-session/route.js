import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request) {
  try {
    const { businessName, ownerName, accountEmail, accountPhone } = await request.json();
    const email = String(accountEmail || "").trim().toLowerCase();
    const clientId = cleanClientId(businessName);

    if (!clientId || !String(ownerName || "").trim() || !email || !String(accountPhone || "").trim()) {
      return NextResponse.json({ error: "Complete every account field before continuing." }, { status: 400 });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid business email address." }, { status: 400 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe is not configured yet." }, { status: 500 });
    }

    const [existingBusiness, existingUser] = await Promise.all([
      getAdminDb().collection("businesses").doc(clientId).get(),
      getAdminAuth().getUserByEmail(email).catch(() => null),
    ]);

    if (existingBusiness.exists) {
      return NextResponse.json({ error: "That business name is already registered." }, { status: 409 });
    }
    if (existingUser) {
      return NextResponse.json({ error: "That business email is already registered." }, { status: 409 });
    }

    const stripe = new Stripe(stripeKey);
    const customer = await stripe.customers.create({
      email,
      name: String(ownerName).trim(),
      phone: String(accountPhone).trim(),
      metadata: { clientId, businessName: String(businessName).trim() },
    });

    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customer.id,
      payment_method_types: ["card"],
      success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/signup?canceled=1`,
      metadata: {
        clientId,
        businessName: String(businessName).trim(),
        ownerName: String(ownerName).trim(),
        accountEmail: email,
        accountPhone: String(accountPhone).trim(),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Unable to create Stripe Checkout Session", error);
    return NextResponse.json({ error: "Unable to start secure card setup." }, { status: 500 });
  }
}
