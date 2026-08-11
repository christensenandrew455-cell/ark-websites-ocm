import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { normalizeOwnerSignup, validateOwnerSignup } from "../../../lib/ownerSignup";
import { ownerSignupDigest } from "../../../lib/ownerSignupServer";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { validateReferrerAccount } from "../../../lib/referrals";
import { checkSignupAvailability, signupAvailabilityMessage } from "../../../lib/signupAvailability";
import { billingPlanDefinition, normalizeBillingPlan } from "../../../lib/stripeUsageBilling";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function missingServerVariables() {
  return [["FIREBASE_PROJECT_ID", process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID], ["FIREBASE_CLIENT_EMAIL", process.env.FIREBASE_CLIENT_EMAIL], ["FIREBASE_PRIVATE_KEY", process.env.FIREBASE_PRIVATE_KEY], ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY]].filter(([, value]) => !value).map(([name]) => name);
}

function safeConfigurationError(error) {
  const message = String(error?.message || "");
  if (/private key|pem|credential|firebase admin/i.test(message)) return "Firebase Admin credentials are invalid. Check the Vercel Firebase variables, then redeploy.";
  if (/stripe|api key|authentication/i.test(message)) return "The Stripe secret key is invalid or belongs to the wrong Stripe mode. Check STRIPE_SECRET_KEY in Vercel, then redeploy.";
  return "Unable to start secure card setup right now.";
}

async function authorize(request) {
  const header = String(request.headers.get("authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in before opening payment setup." }, { status: 401 }) };
  try { return { decoded: await getAdminAuth().verifyIdToken(token, true) }; }
  catch { return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) }; }
}

async function startPaymentGatedSignup(request, rawSignup) {
  const signup = normalizeOwnerSignup(rawSignup, { includePassword: true });
  const validationError = validateOwnerSignup(signup);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const db = getAdminDb();
  const auth = getAdminAuth();
  const rateLimit = await checkRequestRateLimit({ db, request, scope: "owner-signup-payment", limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const clientId = normalizeClientId(signup.businessName);
  const businessRef = db.collection("businesses").doc(clientId);
  const registryRef = db.collection("businessNameRegistry").doc(clientId);
  const [existingBusiness, existingRegistry, availability] = await Promise.all([
    businessRef.get(),
    registryRef.get(),
    checkSignupAvailability({ auth, db, accountEmail: signup.accountEmail, accountPhone: signup.accountPhone }),
  ]);
  if (existingBusiness.exists || existingRegistry.exists) return NextResponse.json({ error: "That business name is already registered. Use a different business name." }, { status: 409 });
  const availabilityError = signupAvailabilityMessage(availability);
  if (availabilityError) return NextResponse.json({ error: availabilityError }, { status: 409 });

  try {
    await validateReferrerAccount({ db, referrerAccountId: signup.referrerAccountId, referredClientId: clientId });
  } catch (error) {
    if (String(error?.message || "") === "SELF_REFERRAL") return NextResponse.json({ error: "A business cannot refer its own account." }, { status: 400 });
    if (String(error?.message || "") === "REFERRER_NOT_FOUND") return NextResponse.json({ error: "That referral account ID is not an active ARK account." }, { status: 400 });
    throw error;
  }

  const plan = billingPlanDefinition("standard");
  const digest = ownerSignupDigest(signup);
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer_creation: "always",
    customer_email: signup.accountEmail,
    payment_method_types: ["card"],
    client_reference_id: digest,
    expires_at: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
    success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/signup/status?canceled=1`,
    metadata: { signupFlow: "payment-gated-v2", signupDigest: digest, clientId, billingPlan: "standard", planName: plan.name },
    setup_intent_data: { metadata: { signupFlow: "payment-gated-v2", signupDigest: digest, clientId } },
  });
  return NextResponse.json({ url: session.url });
}

async function startLegacySignup(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.decoded.uid);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) return NextResponse.json({ error: "The owner account could not be found." }, { status: 404 });
  const account = accountSnapshot.data();
  if (account.status !== "approved_pending_payment") return NextResponse.json({ error: account.status === "active" ? "This account is already active." : "This account is not waiting for payment setup." }, { status: 409 });

  const clientId = String(account.clientId || "").trim();
  const email = String(account.accountEmail || authorization.decoded.email || "").trim().toLowerCase();
  const businessName = String(account.businessName || clientId).trim();
  const ownerName = String(account.ownerName || "").trim();
  const accountPhone = String(account.accountPhone || "").trim();
  const plan = billingPlanDefinition(normalizeBillingPlan(account.billingPlan));
  if (!clientId || !email || !businessName || !ownerName || !accountPhone) return NextResponse.json({ error: "The owner account information is incomplete." }, { status: 409 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let customerId = String(account.stripeCustomerId || "").trim();
  if (!customerId) {
    const customer = await stripe.customers.create({ email, name: ownerName, phone: accountPhone, metadata: { uid: authorization.decoded.uid, clientId, businessName, billingPlan: "standard" } });
    customerId = customer.id;
    const update = { stripeCustomerId: customerId, updatedAt: FieldValue.serverTimestamp() };
    await Promise.all([accountRef.set(update, { merge: true }), db.collection("businesses").doc(clientId).set(update, { merge: true })]);
  } else {
    await stripe.customers.update(customerId, { metadata: { uid: authorization.decoded.uid, clientId, businessName, billingPlan: "standard" } }).catch(() => null);
  }

  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/signup/status?canceled=1`,
    metadata: { uid: authorization.decoded.uid, clientId, businessName, ownerName, accountEmail: email, accountPhone, billingPlan: "standard", planName: plan.name },
  });
  await accountRef.set({ billingPlan: "standard", billingPlanName: plan.name, stripeCheckoutSessionId: session.id, paymentSetupStatus: "in_progress", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return NextResponse.json({ url: session.url });
}

export async function GET() {
  const missing = missingServerVariables();
  return NextResponse.json({ ok: missing.length === 0, service: "signup-checkout", missing }, { status: missing.length === 0 ? 200 : 503 });
}

export async function POST(request) {
  try {
    const missing = missingServerVariables();
    if (missing.length) return NextResponse.json({ error: `Server setup is incomplete. Missing Vercel variables: ${missing.join(", ")}.` }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    return await (body?.signup ? startPaymentGatedSignup(request, body.signup) : startLegacySignup(request));
  } catch (error) {
    console.error("Unable to create Stripe Checkout Session", error);
    return NextResponse.json({ error: safeConfigurationError(error) }, { status: 500 });
  }
}
