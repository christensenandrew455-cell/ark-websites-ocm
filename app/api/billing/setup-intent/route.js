import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function paymentFailure() {
  return "your payment has failed update your payment method or try again later";
}

function applicationReturnUrl(request) {
  const configuredDomain = text(process.env.YOUR_DOMAIN);
  const origin = configuredDomain || new URL(request.url).origin;
  return new URL("/signup/payment", origin).toString();
}

async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: paymentFailure() }, { status: 401 }) };
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    const accountSnapshot = await getAdminDb().collection("accounts").doc(decoded.uid).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : null;
    if (!account || account.role !== "customer" || account.status !== "pending_payment" || account.identityVerificationVerified !== true || account.businessSetupComplete !== true) {
      return { response: NextResponse.json({ error: paymentFailure() }, { status: 403 }) };
    }
    return { decoded, account };
  } catch {
    return { response: NextResponse.json({ error: paymentFailure() }, { status: 401 }) };
  }
}

export async function POST(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY) {
    return NextResponse.json({ error: paymentFailure() }, { status: 503 });
  }

  try {
    const db = getAdminDb();
    const uid = authorization.decoded.uid;
    const account = authorization.account;
    const clientId = text(account.clientId);
    const rateLimit = await checkRequestRateLimit({ db, request, scope: `payment-setup:${uid}`, limit: 12, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let stripeCustomerId = text(account.stripeCustomerId);
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: text(account.accountEmail),
        name: text(account.ownerName),
        phone: text(account.accountPhone),
        metadata: {
          uid,
          clientId,
          businessName: text(account.businessName || clientId),
          billingPlan: "standard",
          accountType: "owner",
          accountStatus: "pending_payment",
        },
      }, { idempotencyKey: `ark-onboarding-customer-${uid}` });
      stripeCustomerId = customer.id;
      const customerFields = { stripeCustomerId, updatedAt: FieldValue.serverTimestamp() };
      await Promise.all([
        db.collection("accounts").doc(uid).set(customerFields, { merge: true }),
        db.collection("businesses").doc(clientId).set(customerFields, { merge: true }),
        db.collection("ocmClients").doc(clientId).set(customerFields, { merge: true }),
        db.collection("ocmClients").doc(clientId).collection("settings").doc("account").set({ StripeCustomerId: stripeCustomerId, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      ]);
    } else {
      await stripe.customers.update(stripeCustomerId, {
        email: text(account.accountEmail),
        name: text(account.ownerName),
        phone: text(account.accountPhone),
        metadata: {
          uid,
          clientId,
          businessName: text(account.businessName || clientId),
          billingPlan: "standard",
          accountType: "owner",
          accountStatus: "pending_payment",
        },
      });
    }

    let setupIntent = null;
    const existingSetupIntentId = text(account.stripeSetupIntentId);
    if (existingSetupIntentId) {
      const existing = await stripe.setupIntents.retrieve(existingSetupIntentId).catch(() => null);
      if (
        existing
        && existing.customer === stripeCustomerId
        && text(existing.metadata?.uid) === uid
        && text(existing.metadata?.clientId) === clientId
        && text(existing.metadata?.purpose) === "ark_onboarding_payment_method"
        && !["canceled", "succeeded"].includes(existing.status)
      ) setupIntent = existing;
    }
    if (!setupIntent) {
      const savedAttempt = Number(account.paymentSetupAttempt || 0);
      const paymentSetupAttempt = Number.isFinite(savedAttempt) ? Math.max(1, Math.floor(savedAttempt) + 1) : 1;
      setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: {
          uid,
          clientId,
          purpose: "ark_onboarding_payment_method",
        },
      }, { idempotencyKey: `ark-onboarding-setup-${uid}-${paymentSetupAttempt}` });
      await Promise.all([
        db.collection("accounts").doc(uid).set({ stripeSetupIntentId: setupIntent.id, paymentSetupAttempt, paymentSetupStatus: "in_progress", updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
        db.collection("businesses").doc(clientId).set({ stripeSetupIntentId: setupIntent.id, paymentSetupAttempt, paymentSetupStatus: "in_progress", updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      ]);
    }

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      returnUrl: applicationReturnUrl(request),
    });
  } catch (error) {
    console.error("Unable to create Stripe SetupIntent", error);
    return NextResponse.json({ error: paymentFailure() }, { status: 500 });
  }
}
