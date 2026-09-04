import { NextResponse } from "next/server";
import Stripe from "stripe";
import { grantAcceptedLeadTopUp } from "../../../lib/acceptedLeadTopUps";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { completeOwnerPaymentSetup } from "../../../lib/ownerPaymentSetup";
import { reportRevenuePayment } from "../../../lib/revenueLedger";
import {
  stripeAcceptedLeadTopUpPaymentFields,
  stripeSubscriptionAccountFields,
} from "../../../lib/stripePlanBilling";
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

function subscriptionIdFromInvoice(invoice) {
  return text(invoice?.subscription?.id || invoice?.subscription || invoice?.parent?.subscription_details?.subscription);
}

function billingMetadataFromInvoice(invoice) {
  return {
    ...(invoice?.subscription_details?.metadata || {}),
    ...(invoice?.parent?.subscription_details?.metadata || {}),
    ...(invoice?.metadata || {}),
  };
}

async function syncStripeSubscription({ db, stripe, subscription, customerId = "", metadata = {} }) {
  const expanded = typeof subscription === "string"
    ? await stripe.subscriptions.retrieve(subscription, { expand: ["items.data.price", "items.data.price.product"] })
    : subscription;
  if (!expanded) return null;
  const match = await findBusinessForStripeCustomer(
    db,
    customerId || text(expanded.customer?.id || expanded.customer),
    { ...(expanded.metadata || {}), ...(metadata || {}) },
  );
  if (!match) return null;
  const synced = stripeSubscriptionAccountFields(expanded, match.business);
  await db.collection("accounts").doc(match.clientId).set(synced.patch, { merge: true });
  return { match, plan: synced.plan, promotion: synced.promotion, subscription: expanded };
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

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      if (text(paymentIntent.metadata?.purpose) === "accepted_lead_top_up") {
        const topUpPayment = stripeAcceptedLeadTopUpPaymentFields(paymentIntent);
        const customerId = text(paymentIntent.customer?.id || paymentIntent.customer);
        const match = await findBusinessForStripeCustomer(db, customerId, paymentIntent.metadata || {});
        if (!match || match.clientId !== text(paymentIntent.metadata?.clientId)) {
          throw new Error("STRIPE_ACCEPTED_LEAD_TOP_UP_ACCOUNT_MISMATCH");
        }
        await grantAcceptedLeadTopUp({
          db,
          clientId: match.clientId,
          provider: "stripe",
          paymentId: paymentIntent.id,
          acceptedLeads: topUpPayment.acceptedLeads,
          amountCents: paymentIntent.amount_received,
          currency: topUpPayment.currency,
          purchasedAt: event.created * 1000,
        });
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

    if (["customer.subscription.created", "customer.subscription.updated"].includes(event.type)) {
      await syncStripeSubscription({ db, stripe, subscription: event.data.object });
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || "";
      let metadata = billingMetadataFromInvoice(invoice);
      let match = await findBusinessForStripeCustomer(db, customerId, metadata);
      if (!match && customerId) {
        const customer = await stripe.customers.retrieve(customerId).catch(() => null);
        if (customer && customer.deleted !== true) metadata = { ...(customer.metadata || {}), ...metadata };
      }
      const subscriptionId = subscriptionIdFromInvoice(invoice) || text(match?.business?.stripeSubscriptionId);
      const synced = subscriptionId
        ? await syncStripeSubscription({ db, stripe, subscription: subscriptionId, customerId, metadata })
        : null;
      match = synced?.match || match;
      const clientId = text(match?.clientId || metadata.clientId);
      if (!clientId) return NextResponse.json({ received: true, ignored: true });
      const businessName = text(match?.business?.businessName || metadata.businessName || clientId);
      const billingPlan = synced?.plan?.key || text(match?.business?.billingPlanKey || metadata.billingPlan || "starter");
      const monthlyAcceptedLeads = synced?.plan?.monthlyAcceptedLeads
        || Number(match?.business?.monthlyAcceptedLeadLimit || metadata.monthlyAcceptedLeads || 0);
      const monthlyCalls = synced?.plan?.monthlyCalls
        || Number(match?.business?.monthlyCallLimit || metadata.monthlyCalls || 0);

      await reportRevenuePayment({
        db,
        eventId: `billing-paid-${invoice.id}`,
        provider: "stripe",
        paymentId: invoice.id,
        paymentKind: "subscription",
        clientId,
        businessName,
        amountCents: Math.max(0, Number(invoice.amount_paid || 0)),
        currency: text(invoice.currency || "usd").toLowerCase(),
        paidAt: Number(invoice.status_transitions?.paid_at || event.created) * 1000,
        summary: `${synced?.plan?.name || "Monthly"} plan payment succeeded`,
        metadata: {
          billingPlan,
          monthlyAcceptedLeads,
          monthlyCalls,
        },
      });

      if (match) {
        const remaining = customerId
          ? await stripe.invoices.list({ customer: customerId, status: "open", limit: 100 })
          : { data: [] };
        const anotherInvoiceIsUnpaid = remaining.data.some((item) => item.id !== invoice.id && Number(item.amount_remaining || 0) > 0);
        if (!anotherInvoiceIsUnpaid && match.business.billingPastDue === true) {
          await resolvePayment({
            db,
            clientId: match.clientId,
            eventId: event.id,
            invoiceId: invoice.id,
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Unable to process Stripe billing webhook", error);
    return NextResponse.json({ error: "Stripe webhook processing failed." }, { status: 400 });
  }
}
