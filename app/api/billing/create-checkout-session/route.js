import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function missingServerVariables() {
  return [
    ["FIREBASE_PROJECT_ID", process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID],
    ["FIREBASE_CLIENT_EMAIL", process.env.FIREBASE_CLIENT_EMAIL],
    ["FIREBASE_PRIVATE_KEY", process.env.FIREBASE_PRIVATE_KEY],
    ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
}

function safeConfigurationError(error) {
  const message = String(error?.message || "");
  if (/private key|pem|credential|firebase admin/i.test(message)) {
    return "Firebase Admin credentials are invalid. Check FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel, then redeploy.";
  }
  if (/stripe|api key|authentication/i.test(message)) {
    return "The Stripe secret key is invalid or belongs to the wrong Stripe mode. Check STRIPE_SECRET_KEY in Vercel, then redeploy.";
  }
  return "Unable to start secure card setup. Check the Vercel function logs for the signup endpoint.";
}

export async function GET() {
  const missing = missingServerVariables();
  return NextResponse.json({
    ok: missing.length === 0,
    service: "signup-checkout",
    missing,
  }, { status: missing.length === 0 ? 200 : 503 });
}

export async function POST(request) {
  try {
    const missing = missingServerVariables();
    if (missing.length) {
      return NextResponse.json(
        { error: `Server setup is incomplete. Missing Vercel variables: ${missing.join(", ")}.` },
        { status: 503 }
      );
    }

    const {
      businessName,
      ownerName,
      accountEmail,
      accountPhone,
      acceptedTerms,
      acceptedPrivacy,
      termsVersion,
      privacyVersion,
    } = await request.json();
    const email = String(accountEmail || "").trim().toLowerCase();
    const clientId = cleanClientId(businessName);

    if (!clientId || !String(ownerName || "").trim() || !email || !String(accountPhone || "").trim()) {
      return NextResponse.json({ error: "Complete every account field before continuing." }, { status: 400 });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid business email address." }, { status: 400 });
    }

    if (acceptedTerms !== true || acceptedPrivacy !== true) {
      return NextResponse.json({ error: "You must agree to the Terms of Use and Privacy Policy before continuing." }, { status: 400 });
    }

    if (termsVersion !== TERMS_VERSION || privacyVersion !== PRIVACY_VERSION) {
      return NextResponse.json({ error: "The legal policies were updated. Refresh the signup page and review the current versions." }, { status: 409 });
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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customer = await stripe.customers.create({
      email,
      name: String(ownerName).trim(),
      phone: String(accountPhone).trim(),
      metadata: { clientId, businessName: String(businessName).trim() },
    });

    const legalAcceptedAt = new Date().toISOString();
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
        legalAccepted: "true",
        legalAcceptedAt,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Unable to create Stripe Checkout Session", error);
    return NextResponse.json({ error: safeConfigurationError(error) }, { status: 500 });
  }
}
