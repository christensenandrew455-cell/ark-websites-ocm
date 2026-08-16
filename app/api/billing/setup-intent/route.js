import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { isStandardRole } from "../../../lib/accountRoles";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { pendingOwnerSignupExpired, readPendingOwnerSignup } from "../../../lib/pendingOwnerSignup";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function paymentFailure() { return "Your payment setup could not be completed. Update the payment method or try again."; }
function applicationReturnUrl(request) {
  const origin = text(process.env.YOUR_DOMAIN) || new URL(request.url).origin;
  return new URL("/signup/payment", origin).toString();
}

async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: paymentFailure() }, { status: 401 }) };
  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(token, true);
    if (!isStandardRole(decoded.role) || decoded.temporaryAccount !== true || text(decoded.accountStatus) !== "pending_payment") {
      return { response: NextResponse.json({ error: paymentFailure() }, { status: 403 }) };
    }
    const db = getAdminDb();
    const pending = await readPendingOwnerSignup({ db, uid: decoded.uid, allowExpired: true });
    if (!pending || pendingOwnerSignupExpired(pending.data) || pending.data.businessSetupComplete !== true || text(pending.data.stage) !== "pending_payment") {
      return { response: NextResponse.json({ error: paymentFailure() }, { status: 403 }) };
    }
    return { auth, db, decoded, pending };
  } catch {
    return { response: NextResponse.json({ error: paymentFailure() }, { status: 401 }) };
  }
}

export async function POST(request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY) return NextResponse.json({ error: paymentFailure() }, { status: 503 });

  try {
    const uid = access.decoded.uid;
    const pending = access.pending.data;
    const account = pending.account || {};
    const payment = pending.payment || {};
    const clientId = text(pending.clientId);
    const rateLimit = await checkRequestRateLimit({ db: access.db, request, scope: `payment-setup:${uid}`, limit: 12, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let stripeCustomerId = text(payment.stripeCustomerId);
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: text(account.accountEmail),
        name: text(account.ownerName),
        phone: text(account.accountPhone),
        metadata: { uid, clientId, businessName: text(account.businessName || clientId), accountType: "owner", accountStatus: "temporary" },
      }, { idempotencyKey: `ark-onboarding-customer-${uid}` });
      stripeCustomerId = customer.id;
    } else {
      await stripe.customers.update(stripeCustomerId, {
        email: text(account.accountEmail),
        name: text(account.ownerName),
        phone: text(account.accountPhone),
      });
    }

    let setupIntent = null;
    const existingSetupIntentId = text(payment.stripeSetupIntentId);
    if (existingSetupIntentId) {
      const existing = await stripe.setupIntents.retrieve(existingSetupIntentId).catch(() => null);
      if (existing && text(existing.customer) === stripeCustomerId && text(existing.metadata?.uid) === uid && !["canceled", "succeeded"].includes(existing.status)) setupIntent = existing;
    }
    const paymentSetupAttempt = Math.max(1, Math.floor(Number(payment.paymentSetupAttempt || 0)) + (setupIntent ? 0 : 1));
    if (!setupIntent) {
      setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: { uid, clientId, purpose: "ark_onboarding_payment_method" },
      }, { idempotencyKey: `ark-onboarding-setup-${uid}-${paymentSetupAttempt}` });
    }

    await access.pending.ref.set({
      payment: { ...payment, status: "in_progress", stripeCustomerId, stripeSetupIntentId: setupIntent.id, paymentSetupAttempt },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ clientSecret: setupIntent.client_secret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY, returnUrl: applicationReturnUrl(request) });
  } catch (error) {
    console.error("Unable to create Stripe SetupIntent", error);
    return NextResponse.json({ error: paymentFailure() }, { status: 500 });
  }
}
