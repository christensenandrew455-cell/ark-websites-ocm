import { NextResponse } from "next/server";
import Stripe from "stripe";
import { grantAcceptedLeadTopUp } from "../../../lib/acceptedLeadTopUps";
import { requireUser } from "../../../lib/userRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import {
  refreshStoredPaymentMethod,
  retrieveStripeAcceptedLeadTopUpPrice,
  STRIPE_ACCEPTED_LEAD_TOP_UP_CONFIGURATION_ERROR,
  stripeAcceptedLeadTopUpPaymentFields,
} from "../../../lib/stripePlanBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function acceptedLeadQuantity(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 999_999 ? parsed : 0;
}

function validRequestId(value) {
  const candidate = text(value);
  return /^[a-z0-9][a-z0-9_-]{7,99}$/i.test(candidate) ? candidate : "";
}

function publicPaymentIntent(paymentIntent, publishableKey) {
  if (paymentIntent.status === "succeeded") {
    return { status: "succeeded", paymentIntentId: paymentIntent.id };
  }
  if (paymentIntent.status === "requires_action" && paymentIntent.client_secret) {
    return {
      status: "requires_action",
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      publishableKey,
    };
  }
  return {
    status: paymentIntent.status,
    paymentIntentId: paymentIntent.id,
    error: text(paymentIntent.last_payment_error?.message) || "The top-up payment did not complete. Update the card or try again.",
  };
}

async function activeStripeAccount(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization;
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const snapshot = await accountRef.get();
  if (!snapshot.exists) {
    return { response: NextResponse.json({ error: "This account could not be found." }, { status: 404 }) };
  }
  const account = snapshot.data();
  if (text(account.status) !== "active" || account.billingPastDue === true) {
    return { response: NextResponse.json({ error: "Resolve the account payment issue before adding leads." }, { status: 409 }) };
  }
  if (text(account.billingProvider || "stripe") !== "stripe") {
    return { response: NextResponse.json({ error: "Use Apple to add leads to this account." }, { status: 409 }) };
  }
  return { ...authorization, db, accountRef, account };
}

async function settlePayment({ access, paymentIntent }) {
  const topUpPayment = stripeAcceptedLeadTopUpPaymentFields(paymentIntent);
  const customerId = text(paymentIntent.customer?.id || paymentIntent.customer);
  if (text(paymentIntent.metadata?.clientId) !== access.clientId
    || customerId !== text(access.account.stripeCustomerId)
  ) {
    throw new Error("STRIPE_ACCEPTED_LEAD_TOP_UP_FORBIDDEN");
  }
  if (paymentIntent.status !== "succeeded") throw new Error("STRIPE_ACCEPTED_LEAD_TOP_UP_UNPAID");
  return grantAcceptedLeadTopUp({
    db: access.db,
    clientId: access.clientId,
    provider: "stripe",
    paymentId: paymentIntent.id,
    acceptedLeads: topUpPayment.acceptedLeads,
    amountCents: paymentIntent.amount_received,
    currency: topUpPayment.currency,
    purchasedAt: Number(paymentIntent.created || 0) * 1000,
  });
}

export async function POST(request) {
  const access = await activeStripeAccount(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({}));
  const acceptedLeads = acceptedLeadQuantity(body.acceptedLeads);
  const requestId = validRequestId(body.requestId);
  if (!acceptedLeads || !requestId) {
    return NextResponse.json({ error: "Enter a whole number of additional leads." }, { status: 400 });
  }
  const rateLimit = await checkRequestRateLimit({ db: access.db, request, scope: `lead-top-up:${access.clientId}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  const publishableKey = text(process.env.STRIPE_PUBLISHABLE_KEY);
  if (!stripeSecretKey || !publishableKey) {
    return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    const topUpPrice = await retrieveStripeAcceptedLeadTopUpPrice({ stripe });
    const syncedPayment = await refreshStoredPaymentMethod({
      stripe,
      db: access.db,
      clientId: access.clientId,
      customerId: text(access.account.stripeCustomerId),
      subscriptionId: text(access.account.stripeSubscriptionId),
      fallbackPaymentMethodId: text(access.account.stripePaymentMethodId),
    });
    if (!syncedPayment.paymentMethodId) {
      return NextResponse.json({ error: "Add a card before buying additional leads." }, { status: 409 });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: acceptedLeads * topUpPrice.unitAmountCents,
      currency: topUpPrice.currency,
      customer: text(access.account.stripeCustomerId),
      payment_method: syncedPayment.paymentMethodId,
      payment_method_types: ["card"],
      confirm: true,
      use_stripe_sdk: true,
      description: `${acceptedLeads} additional ARK accepted leads`,
      metadata: {
        purpose: "accepted_lead_top_up",
        clientId: access.clientId,
        uid: text(access.decodedToken.uid),
        acceptedLeads: String(acceptedLeads),
        acceptedLeadTopUpPriceId: topUpPrice.priceId,
        acceptedLeadUnitAmountCents: String(topUpPrice.unitAmountCents),
      },
    }, { idempotencyKey: `ark-lead-top-up-${access.clientId}-${requestId}` });
    const publicIntent = publicPaymentIntent(paymentIntent, publishableKey);
    if (paymentIntent.status === "succeeded") {
      const topUp = await settlePayment({ access, paymentIntent });
      return NextResponse.json({ ...publicIntent, topUp });
    }
    return NextResponse.json(publicIntent, { status: paymentIntent.status === "requires_action" ? 200 : 402 });
  } catch (error) {
    console.error("Unable to create accepted-lead top-up payment", error);
    if (text(error?.code) === STRIPE_ACCEPTED_LEAD_TOP_UP_CONFIGURATION_ERROR) {
      return NextResponse.json({ error: "Extra-lead purchases are not configured yet." }, { status: 503 });
    }
    return NextResponse.json({
      error: text(error?.raw?.message || error?.message).startsWith("Stripe")
        ? "The top-up payment did not complete. Update the card or try again."
        : "Could not add leads right now. Try again.",
    }, { status: 500 });
  }
}

export async function PUT(request) {
  const access = await activeStripeAccount(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({}));
  const paymentIntentId = text(body.paymentIntentId);
  if (!/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId)) {
    return NextResponse.json({ error: "The top-up payment is invalid." }, { status: 400 });
  }
  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  if (!stripeSecretKey) return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  try {
    const stripe = new Stripe(stripeSecretKey);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const publicIntent = publicPaymentIntent(paymentIntent, text(process.env.STRIPE_PUBLISHABLE_KEY));
    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json(publicIntent, { status: 402 });
    }
    const topUp = await settlePayment({ access, paymentIntent });
    return NextResponse.json({ ...publicIntent, topUp });
  } catch (error) {
    console.error("Unable to verify accepted-lead top-up payment", error);
    return NextResponse.json({ error: "Could not verify the top-up payment. Refresh and try again." }, { status: 400 });
  }
}
