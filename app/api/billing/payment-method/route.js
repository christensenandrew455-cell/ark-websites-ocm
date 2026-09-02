import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { refreshStoredPaymentMethod } from "../../../lib/stripePlanBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function objectId(value) {
  return text(value?.id || value);
}

async function activeStripeAccount(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization;
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const snapshot = await accountRef.get();
  if (!snapshot.exists) return { response: NextResponse.json({ error: "This account could not be found." }, { status: 404 }) };
  const account = snapshot.data();
  if (text(account.billingProvider || "stripe") !== "stripe") {
    return { response: NextResponse.json({ error: "Apple controls the payment method for this subscription." }, { status: 409 }) };
  }
  if (!text(account.stripeCustomerId)) {
    return { response: NextResponse.json({ error: "The Stripe billing account is not connected. Contact support." }, { status: 409 }) };
  }
  return { ...authorization, db, accountRef, account };
}

export async function POST(request) {
  const access = await activeStripeAccount(request);
  if (access.response) return access.response;
  const rateLimit = await checkRequestRateLimit({ db: access.db, request, scope: `payment-method:${access.clientId}`, limit: 12, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  const publishableKey = text(process.env.STRIPE_PUBLISHABLE_KEY);
  if (!stripeSecretKey || !publishableKey) {
    return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  }
  try {
    const stripe = new Stripe(stripeSecretKey);
    const setupIntent = await stripe.setupIntents.create({
      customer: text(access.account.stripeCustomerId),
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        purpose: "ark_account_payment_method_update",
        clientId: access.clientId,
      },
    });
    const returnUrl = new URL("/settings?section=payment&manage=card", new URL(request.url).origin).toString();
    return NextResponse.json({
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
      publishableKey,
      returnUrl,
    });
  } catch (error) {
    console.error("Unable to create account payment-method SetupIntent", error);
    return NextResponse.json({ error: "Secure card fields could not open. Try again." }, { status: 500 });
  }
}

export async function PUT(request) {
  const access = await activeStripeAccount(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({}));
  const setupIntentId = text(body.setupIntentId);
  if (!/^seti_[a-zA-Z0-9_]+$/.test(setupIntentId)) {
    return NextResponse.json({ error: "The card update is invalid." }, { status: 400 });
  }
  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  if (!stripeSecretKey) return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  try {
    const stripe = new Stripe(stripeSecretKey);
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
    const paymentMethodId = objectId(setupIntent.payment_method);
    if (setupIntent.status !== "succeeded"
      || text(setupIntent.metadata?.purpose) !== "ark_account_payment_method_update"
      || text(setupIntent.metadata?.clientId) !== access.clientId
      || objectId(setupIntent.customer) !== text(access.account.stripeCustomerId)
      || !paymentMethodId) {
      return NextResponse.json({ error: "The card update has not completed." }, { status: 409 });
    }
    const paymentMethodCustomer = objectId(setupIntent.payment_method?.customer);
    if (paymentMethodCustomer && paymentMethodCustomer !== text(access.account.stripeCustomerId)) {
      return NextResponse.json({ error: "That card belongs to a different billing account." }, { status: 403 });
    }
    await stripe.customers.update(text(access.account.stripeCustomerId), {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    if (text(access.account.stripeSubscriptionId)) {
      await stripe.subscriptions.update(text(access.account.stripeSubscriptionId), {
        default_payment_method: paymentMethodId,
      });
    }
    const saved = await refreshStoredPaymentMethod({
      stripe,
      db: access.db,
      clientId: access.clientId,
      customerId: text(access.account.stripeCustomerId),
      subscriptionId: text(access.account.stripeSubscriptionId),
      fallbackPaymentMethodId: paymentMethodId,
    });
    return NextResponse.json({ status: "succeeded", paymentMethodLabel: saved.paymentMethodLabel });
  } catch (error) {
    console.error("Unable to save account payment method", error);
    return NextResponse.json({ error: "The card could not be saved. Try again." }, { status: 400 });
  }
}
