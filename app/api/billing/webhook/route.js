import { NextResponse } from "next/server";
import Stripe from "stripe";
import { sendAdminEvent } from "../../../lib/adminEvents";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { completeOwnerPaymentSetup } from "../../../lib/ownerPaymentSetup";
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

    if (event.type === "setup_intent.succeeded") {
      const setupIntent = event.data.object;
      const uid = text(setupIntent.metadata?.uid);
      if (!uid) return NextResponse.json({ received: true, ignored: true });
      try {
        await completeOwnerPaymentSetup({
          db,
          auth: getAdminAuth(),
          stripe,
          uid,
          setupIntentId: setupIntent.id,
        });
      } catch (setupError) {
        const nonActionable = new Set(["ACCOUNT_NOT_FOUND", "OWNER_ACCOUNT_REQUIRED", "PAYMENT_SETUP_FORBIDDEN", "PAYMENT_SETUP_EXPIRED"]);
        if (!nonActionable.has(text(setupError?.message))) throw setupError;
        console.warn("Ignoring stale or unowned Stripe payment-method setup event", setupIntent.id);
        return NextResponse.json({ received: true, ignored: true });
      }
    }

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
        failedAt: event.created * 1000,
      });
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || "";
      const match = await findBusinessForStripeCustomer(db, customerId, invoice.metadata || {});
      if (!match) return NextResponse.json({ received: true, ignored: true });

      await sendAdminEvent({
        id: `billing-paid-${invoice.id}`,
        type: "billing.payment_succeeded",
        clientId: match.clientId,
        businessName: text(match.business.businessName || match.clientId),
        summary: "Monthly payment succeeded",
        metadata: {
          paymentId: invoice.id,
          paymentKind: "subscription",
          amountCents: Math.max(0, Number(invoice.amount_paid || 0)),
          currency: text(invoice.currency || "usd").toLowerCase(),
        },
        occurredAt: new Date(event.created * 1000).toISOString(),
      });

      const remaining = customerId
        ? await stripe.invoices.list({ customer: customerId, status: "open", limit: 100 })
        : { data: [] };
      const anotherInvoiceIsUnpaid = remaining.data.some((item) => item.id !== invoice.id && Number(item.amount_remaining || 0) > 0);
      if (!anotherInvoiceIsUnpaid && match.business.billingFailureKind !== "usage") {
        await resolvePayment({
          db,
          clientId: match.clientId,
          eventId: event.id,
          invoiceId: invoice.id,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Unable to process Stripe billing webhook", error);
    return NextResponse.json({ error: "Stripe webhook processing failed." }, { status: 400 });
  }
}
