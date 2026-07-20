import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return "Firebase Admin credentials are invalid. Check the Vercel Firebase variables, then redeploy.";
  }
  if (/stripe|api key|authentication/i.test(message)) {
    return "The Stripe secret key is invalid or belongs to the wrong Stripe mode. Check STRIPE_SECRET_KEY in Vercel, then redeploy.";
  }
  return "Unable to start secure card setup right now.";
}

async function authorize(request) {
  const header = String(request.headers.get("authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in before opening payment setup." }, { status: 401 }) };
  try {
    return { decoded: await getAdminAuth().verifyIdToken(token, true) };
  } catch {
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
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
      return NextResponse.json({ error: `Server setup is incomplete. Missing Vercel variables: ${missing.join(", ")}.` }, { status: 503 });
    }

    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;

    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(authorization.decoded.uid);
    const accountSnapshot = await accountRef.get();
    if (!accountSnapshot.exists) {
      return NextResponse.json({ error: "The account application could not be found." }, { status: 404 });
    }

    const account = accountSnapshot.data();
    if (account.status !== "approved_pending_payment") {
      const error = account.status === "pending_verification"
        ? "ARK must verify the account before payment setup."
        : account.status === "declined"
          ? "This account was declined and cannot continue to payment setup."
          : "This account is not waiting for payment setup.";
      return NextResponse.json({ error }, { status: 409 });
    }

    const clientId = String(account.clientId || "").trim();
    const email = String(account.accountEmail || authorization.decoded.email || "").trim().toLowerCase();
    const businessName = String(account.businessName || clientId).trim();
    const ownerName = String(account.ownerName || "").trim();
    const accountPhone = String(account.accountPhone || "").trim();
    if (!clientId || !email || !businessName || !ownerName || !accountPhone) {
      return NextResponse.json({ error: "The approved account information is incomplete." }, { status: 409 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let customerId = String(account.stripeCustomerId || "").trim();
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: ownerName,
        phone: accountPhone,
        metadata: { uid: authorization.decoded.uid, clientId, businessName },
      });
      customerId = customer.id;
      const update = { stripeCustomerId: customerId, updatedAt: FieldValue.serverTimestamp() };
      await Promise.all([
        accountRef.set(update, { merge: true }),
        db.collection("businesses").doc(clientId).set(update, { merge: true }),
      ]);
    }

    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/signup/status?canceled=1`,
      metadata: {
        uid: authorization.decoded.uid,
        clientId,
        businessName,
        ownerName,
        accountEmail: email,
        accountPhone,
      },
    });

    await accountRef.set({
      stripeCheckoutSessionId: session.id,
      paymentSetupStatus: "in_progress",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Unable to create Stripe Checkout Session", error);
    return NextResponse.json({ error: safeConfigurationError(error) }, { status: 500 });
  }
}
