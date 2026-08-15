import { FieldValue } from "firebase-admin/firestore";

function text(value) {
  return String(value || "").trim();
}

function paymentMethodId(value) {
  return typeof value === "string" ? value : text(value?.id);
}

function customerId(value) {
  return typeof value === "string" ? value : text(value?.id);
}

function savedPaymentMethodLabel(paymentMethod) {
  if (!paymentMethod?.card) return "Payment method saved in Stripe";
  const brand = text(paymentMethod.card.brand || "Card");
  const label = `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`;
  return `${label} ending in ${text(paymentMethod.card.last4)}`;
}

export async function completeOwnerPaymentSetup({ db, auth, stripe, uid, setupIntentId }) {
  const safeUid = text(uid);
  const safeSetupIntentId = text(setupIntentId);
  if (!safeUid || !safeSetupIntentId) throw new Error("PAYMENT_SETUP_MISSING");

  const accountRef = db.collection("accounts").doc(safeUid);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
  const account = accountSnapshot.data();
  if (account.role !== "customer") throw new Error("OWNER_ACCOUNT_REQUIRED");

  const clientId = text(account.clientId);
  const storedCustomerId = text(account.stripeCustomerId);
  if (!clientId || !storedCustomerId) throw new Error("STRIPE_CUSTOMER_MISSING");
  const alreadyComplete = account.status === "active"
    && account.paymentSetupStatus === "complete"
    && text(account.stripeSetupIntentId) === safeSetupIntentId;
  if (!alreadyComplete && account.status !== "pending_payment") throw new Error("PAYMENT_SETUP_FORBIDDEN");
  if (!alreadyComplete && (account.identityVerificationVerified !== true || account.businessSetupComplete !== true)) {
    throw new Error("PAYMENT_SETUP_FORBIDDEN");
  }
  if (text(account.stripeSetupIntentId) !== safeSetupIntentId) throw new Error("PAYMENT_SETUP_FORBIDDEN");

  const setupIntent = await stripe.setupIntents.retrieve(safeSetupIntentId, {
    expand: ["payment_method"],
  });
  if (setupIntent.status !== "succeeded") throw new Error("PAYMENT_SETUP_INCOMPLETE");
  if (customerId(setupIntent.customer) !== storedCustomerId) throw new Error("PAYMENT_SETUP_FORBIDDEN");
  if (
    text(setupIntent.metadata?.uid) !== safeUid
    || text(setupIntent.metadata?.clientId) !== clientId
    || text(setupIntent.metadata?.purpose) !== "ark_onboarding_payment_method"
  ) {
    throw new Error("PAYMENT_SETUP_FORBIDDEN");
  }

  const savedPaymentMethodId = paymentMethodId(setupIntent.payment_method);
  if (!savedPaymentMethodId) throw new Error("PAYMENT_METHOD_MISSING");
  const paymentMethod = typeof setupIntent.payment_method === "string"
    ? await stripe.paymentMethods.retrieve(savedPaymentMethodId)
    : setupIntent.payment_method;
  const paymentMethodLabel = savedPaymentMethodLabel(paymentMethod);

  if (alreadyComplete) {
    return {
      status: "succeeded",
      clientId,
      paymentMethodId: savedPaymentMethodId,
      paymentMethodLabel,
    };
  }

  await stripe.customers.update(storedCustomerId, {
    email: text(account.accountEmail),
    name: text(account.ownerName),
    phone: text(account.accountPhone),
    invoice_settings: { default_payment_method: savedPaymentMethodId },
    metadata: {
      uid: safeUid,
      clientId,
      businessName: text(account.businessName || clientId),
      billingPlan: "standard",
      accountType: "owner",
      accountStatus: "active",
    },
  });

  const activatedAt = FieldValue.serverTimestamp();
  const activeFields = {
    status: "active",
    paymentSetupStatus: "complete",
    businessSetupComplete: true,
    stripeCustomerId: storedCustomerId,
    stripeSetupIntentId: safeSetupIntentId,
    stripePaymentMethodId: savedPaymentMethodId,
    paymentMethodLabel,
    numberAssignmentStatus: "needed",
    receptionistPhone: "",
    onboardingTourStatus: "pending",
    billingPastDue: false,
    activatedAt,
    paymentMethodSavedAt: activatedAt,
    submittedForNumberAt: activatedAt,
    updatedAt: activatedAt,
  };
  const clientRef = db.collection("ocmClients").doc(clientId);
  const batch = db.batch();
  batch.set(accountRef, activeFields, { merge: true });
  batch.set(db.collection("businesses").doc(clientId), activeFields, { merge: true });
  batch.set(clientRef, activeFields, { merge: true });
  batch.set(db.collection("businessNameRegistry").doc(clientId), {
    clientId,
    businessName: text(account.businessName || clientId),
    ownerUid: safeUid,
    status: "active",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(clientRef.collection("settings").doc("account"), {
    BillingStatus: "Payment method saved",
    PaymentSetupStatus: "Complete",
    PaymentMethodLabel: paymentMethodLabel,
    StripeCustomerId: storedCustomerId,
    StripeSetupIntentId: safeSetupIntentId,
    NumberAssignmentStatus: "Needed",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  const userRecord = await auth.getUser(safeUid);
  await auth.setCustomUserClaims(safeUid, {
    ...(userRecord.customClaims || {}),
    role: "customer",
    clientId,
    accountStatus: "active",
    identityVerificationRequired: false,
    identityVerificationVerified: true,
  });

  return {
    status: "succeeded",
    clientId,
    paymentMethodId: savedPaymentMethodId,
    paymentMethodLabel,
  };
}
