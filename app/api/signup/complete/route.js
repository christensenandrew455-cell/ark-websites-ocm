import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

export async function POST(request) {
  let createdUser = null;
  let accountCommitted = false;

  try {
    const { sessionId, password } = await request.json();
    if (!sessionId || typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "The signup session or password is invalid." }, { status: 400 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe is not configured yet." }, { status: 500 });
    }

    const db = getAdminDb();
    const receiptRef = db.collection("signupSessions").doc(sessionId);
    const existingReceipt = await receiptRef.get();
    if (existingReceipt.exists) {
      const receipt = existingReceipt.data();
      return NextResponse.json({ email: receipt.email, clientId: receipt.clientId, completed: true });
    }

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    const setupIntent = session.setup_intent;
    const setupIntentStatus = typeof setupIntent === "string" ? "succeeded" : setupIntent?.status;

    if (session.mode !== "setup" || session.status !== "complete" || !setupIntent || setupIntentStatus !== "succeeded") {
      return NextResponse.json({ error: "Stripe has not confirmed the card setup." }, { status: 402 });
    }

    const metadata = session.metadata || {};
    const { clientId, businessName, ownerName, accountEmail, accountPhone } = metadata;
    if (!clientId || !businessName || !ownerName || !accountEmail || !accountPhone) {
      return NextResponse.json({ error: "The Stripe signup details are incomplete." }, { status: 400 });
    }

    const [businessSnapshot, existingUser] = await Promise.all([
      db.collection("businesses").doc(clientId).get(),
      getAdminAuth().getUserByEmail(accountEmail).catch(() => null),
    ]);

    if (businessSnapshot.exists || existingUser) {
      return NextResponse.json({ error: "This business or email is already registered." }, { status: 409 });
    }

    createdUser = await getAdminAuth().createUser({
      email: accountEmail,
      password,
      displayName: ownerName,
      emailVerified: false,
    });
    await getAdminAuth().setCustomUserClaims(createdUser.uid, { role: "customer", clientId });

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";
    const setupIntentId = typeof setupIntent === "string" ? setupIntent : setupIntent.id;
    const accountData = {
      uid: createdUser.uid,
      clientId,
      role: "customer",
      businessName,
      ownerName,
      accountEmail,
      accountPhone,
      status: "active",
      stripeCustomerId: customerId,
      stripeSetupIntentId: setupIntentId,
      createdAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(db.collection("accounts").doc(createdUser.uid), accountData);
    batch.set(db.collection("businesses").doc(clientId), accountData);
    batch.set(db.collection("ocmClients").doc(clientId), {
      businessName,
      ownerUid: createdUser.uid,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(receiptRef, { email: accountEmail, clientId, completed: true, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();
    accountCommitted = true;

    if (customerId) {
      await stripe.customers
        .update(customerId, { metadata: { uid: createdUser.uid, clientId, businessName } })
        .catch((stripeError) => console.error("Unable to update Stripe customer metadata", stripeError));
    }

    return NextResponse.json({ email: accountEmail, clientId, completed: true });
  } catch (error) {
    console.error("Unable to complete signup", error);
    if (createdUser?.uid && !accountCommitted) {
      await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    }
    return NextResponse.json({ error: "Unable to finish account setup. Please contact support." }, { status: 500 });
  }
}
