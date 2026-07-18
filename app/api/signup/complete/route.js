import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSignupError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "");
  const message = String(error?.message || error?.errorInfo?.message || "");

  if (code === "auth/configuration-not-found" || /no configuration corresponding/i.test(message)) {
    return "Firebase Authentication is not enabled for this Firebase project. In Firebase Console, open Authentication, click Get started if shown, then enable Email/Password under Sign-in method.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Email/Password sign-in is disabled in Firebase. Enable Email/Password under Firebase Authentication > Sign-in method.";
  }

  if (/private key|pem|credential|firebase admin/i.test(message)) {
    return "Firebase Admin credentials are invalid. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Vercel, then redeploy.";
  }

  return "Unable to finish account setup. Check the Vercel function logs for the signup completion endpoint.";
}

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
    const {
      clientId,
      businessName,
      ownerName,
      accountEmail,
      accountPhone,
      legalAccepted,
      legalAcceptedAt,
      termsVersion,
      privacyVersion,
    } = metadata;
    if (!clientId || !businessName || !ownerName || !accountEmail || !accountPhone) {
      return NextResponse.json({ error: "The Stripe signup details are incomplete." }, { status: 400 });
    }

    const acceptedAtDate = new Date(legalAcceptedAt || "");
    if (
      legalAccepted !== "true"
      || termsVersion !== TERMS_VERSION
      || privacyVersion !== PRIVACY_VERSION
      || Number.isNaN(acceptedAtDate.getTime())
    ) {
      return NextResponse.json({ error: "The legal agreement record is missing or outdated. Restart signup and accept the current policies." }, { status: 409 });
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

    const isAdmin = getAdminEmails().has(accountEmail.toLowerCase());
    const role = isAdmin ? "admin" : "customer";
    const claims = isAdmin ? { role: "admin", clientId } : { role: "customer", clientId };
    await getAdminAuth().setCustomUserClaims(createdUser.uid, claims);

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";
    const setupIntentId = typeof setupIntent === "string" ? setupIntent : setupIntent.id;
    const paymentMethodId = typeof setupIntent === "string"
      ? ""
      : typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id || "";

    let paymentMethodLabel = "Card saved in Stripe";
    if (paymentMethodId) {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
      if (paymentMethod?.card) {
        const brand = String(paymentMethod.card.brand || "Card");
        paymentMethodLabel = `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${paymentMethod.card.last4}`;
      }
    }

    const accountData = {
      uid: createdUser.uid,
      clientId,
      role,
      businessName,
      ownerName,
      accountEmail,
      accountPhone,
      status: "active",
      stripeCustomerId: customerId,
      stripeSetupIntentId: setupIntentId,
      stripePaymentMethodId: paymentMethodId,
      paymentMethodLabel,
      paymentSetupStatus: "complete",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
      legalAcceptedAt: acceptedAtDate,
      legalAcceptedBy: accountEmail,
      legalAcceptanceSource: "signup-checkout",
      legalRecordedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(db.collection("accounts").doc(createdUser.uid), accountData);
    batch.set(db.collection("businesses").doc(clientId), accountData);
    batch.set(db.collection("ocmClients").doc(clientId), {
      businessName,
      ownerUid: createdUser.uid,
      status: "active",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
      legalAcceptedAt: acceptedAtDate,
      legalAcceptedBy: accountEmail,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), {
      BusinessName: businessName,
      OwnerName: ownerName,
      AccountEmail: accountEmail,
      AccountPhone: accountPhone,
      BillingEmail: accountEmail,
      BillingStatus: "Active",
      PaymentMethodLabel: paymentMethodLabel,
      StripeCustomerId: customerId,
      TermsAccepted: true,
      PrivacyAccepted: true,
      TermsVersion: termsVersion,
      PrivacyVersion: privacyVersion,
      LegalAcceptedAt: acceptedAtDate,
      LegalAcceptedBy: accountEmail,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const adminClientId = String(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm").trim();
    if (adminClientId && clientId !== adminClientId) {
      batch.set(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId), {
        Name: ownerName,
        BusinessName: businessName,
        Phone: accountPhone,
        Email: accountEmail,
        Address: businessName,
        PropertyKey: `business-${clientId}`,
        Job: "ARK OCM account",
        BestContactMethod: accountPhone ? "Call" : "Email",
        Notes: `ARK OCM customer account for ${businessName}.`,
        source: "business-signup",
        RelatedBusinessClientId: clientId,
        AccountStatus: "active",
        TermsAccepted: true,
        PrivacyAccepted: true,
        TermsVersion: termsVersion,
        PrivacyVersion: privacyVersion,
        LegalAcceptedAt: acceptedAtDate,
        ContactNames: ownerName ? [ownerName] : [],
        Phones: accountPhone ? [accountPhone] : [],
        Emails: accountEmail ? [accountEmail] : [],
        currentStage: "clients",
        TotalJobs: 1,
        RepeatJobs: 0,
        createdAt: FieldValue.serverTimestamp(),
        movedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    batch.set(receiptRef, {
      email: accountEmail,
      clientId,
      uid: createdUser.uid,
      completed: true,
      termsVersion,
      privacyVersion,
      legalAcceptedAt: acceptedAtDate,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    accountCommitted = true;

    if (customerId) {
      await stripe.customers.update(customerId, {
        metadata: { uid: createdUser.uid, clientId, businessName },
      }).catch((stripeError) => console.error("Unable to update Stripe customer metadata", stripeError));
    }

    return NextResponse.json({ email: accountEmail, clientId, completed: true });
  } catch (error) {
    console.error("Unable to complete signup", error);
    if (createdUser?.uid && !accountCommitted) {
      await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    }
    return NextResponse.json({ error: safeSignupError(error) }, { status: 500 });
  }
}
