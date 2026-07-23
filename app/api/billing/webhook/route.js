import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminDb } from "../../../lib/firebase-admin";
import {
  findBusinessForStripeCustomer,
  registerPaymentFailure,
  resolvePayment,
} from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  const stripeKey = text(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = text(process.env.STRIPE_WEBHOOK_SECRET);
  const signature = text(request.headers.get("stripe-signature"));

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook configuration is incomplete." }, { status: 503 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Stripe signature is missing." }, { status: 400 });
  }

  try {
    const stripe = new Stripe(stripeKey);
    const rawBody = await request.text();
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const db = getAdminDb();

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || "";
      const match = await findBusinessForStripeCustomer(db, customerId, invoice.metadata || {});
      if (!match) return NextResponse.json({ received: true, ignored: true });

      await registerPaymentFailure({
        db,
        clientId: match.clientId,
        eventId: event.id,
        invoiceId: invoice.id,
        amountDue: invoice.amount_due || invoice.amount_remaining || 0,
        currency: invoice.currency || "usd",
        failedAt: event.created * 1000,
      });
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || "";
      const match = await findBusinessForStripeCustomer(db, customerId, invoice.metadata || {});
      if (!match) return NextResponse.json({ received: true, ignored: true });

      await resolvePayment({
        db,
        clientId: match.clientId,
        eventId: event.id,
        invoiceId: invoice.id,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Unable to process Stripe billing webhook", error);
    return NextResponse.json({ error: "Stripe webhook processing failed." }, { status: 400 });
  }
}
