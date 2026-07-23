import { FieldValue, Timestamp } from "firebase-admin/firestore";

const DAY_MS = 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 183 * DAY_MS;

function text(value) {
  return String(value || "").trim();
}

export function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function computeBillingState(data = {}, now = Date.now()) {
  if (data.billingPastDue !== true) {
    return {
      phase: "current",
      restricted: false,
      showNotice: false,
      serviceAccess: "full",
      offenseNumber: 0,
      quietEndsAt: 0,
      graceEndsAt: 0,
      reviewAt: 0,
    };
  }

  const offenseNumber = Math.max(1, Number(data.billingOffenseNumber || 1));
  const failureAt = asMillis(data.billingFailureAt) || now;
  const quietEndsAt = asMillis(data.billingQuietEndsAt) || failureAt + DAY_MS;
  const graceEndsAt = asMillis(data.billingGraceEndsAt)
    || (offenseNumber === 1 ? quietEndsAt + 7 * DAY_MS : quietEndsAt);
  const reviewAt = asMillis(data.billingDeletionReviewAt)
    || (offenseNumber >= 3 ? quietEndsAt : graceEndsAt + 7 * DAY_MS);

  if (now < quietEndsAt) {
    return {
      phase: "quiet",
      restricted: false,
      showNotice: false,
      serviceAccess: "full",
      offenseNumber,
      failureAt,
      quietEndsAt,
      graceEndsAt,
      reviewAt,
    };
  }

  if (offenseNumber === 1 && now < graceEndsAt) {
    return {
      phase: "grace",
      restricted: false,
      showNotice: true,
      serviceAccess: "full",
      offenseNumber,
      failureAt,
      quietEndsAt,
      graceEndsAt,
      reviewAt,
    };
  }

  if (now < reviewAt) {
    return {
      phase: "restricted",
      restricted: true,
      showNotice: true,
      serviceAccess: "leads-only",
      offenseNumber,
      failureAt,
      quietEndsAt,
      graceEndsAt,
      reviewAt,
    };
  }

  return {
    phase: "deletion-review",
    restricted: true,
    showNotice: true,
    serviceAccess: "leads-only",
    offenseNumber,
    failureAt,
    quietEndsAt,
    graceEndsAt,
    reviewAt,
  };
}

export function publicBillingStatus(data = {}, now = Date.now()) {
  const state = computeBillingState(data, now);
  return {
    ...state,
    amountDue: Math.max(0, Number(data.billingAmountDue || 0)),
    currency: text(data.billingCurrency || "usd").toLowerCase(),
    invoiceId: text(data.billingInvoiceId),
    failureAt: state.failureAt ? new Date(state.failureAt).toISOString() : "",
    quietEndsAt: state.quietEndsAt ? new Date(state.quietEndsAt).toISOString() : "",
    graceEndsAt: state.graceEndsAt ? new Date(state.graceEndsAt).toISOString() : "",
    reviewAt: state.reviewAt ? new Date(state.reviewAt).toISOString() : "",
  };
}

export async function findBusinessForStripeCustomer(db, customerId, metadata = {}) {
  const metadataClientId = text(metadata.clientId);
  if (metadataClientId) {
    const direct = await db.collection("businesses").doc(metadataClientId).get();
    if (direct.exists) return { clientId: direct.id, business: direct.data() };
  }

  if (!customerId) return null;
  const snapshot = await db.collection("businesses")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return { clientId: snapshot.docs[0].id, business: snapshot.docs[0].data() };
}

function mirroredBillingPatch(patch) {
  return {
    BillingStatus: patch.billingPastDue === false ? "Active" : patch.billingPhase,
    BillingPastDue: patch.billingPastDue,
    BillingPhase: patch.billingPhase,
    ServiceAccess: patch.serviceAccess,
    BillingOffenseNumber: patch.billingOffenseNumber || 0,
    BillingFailureAt: patch.billingFailureAt || FieldValue.delete(),
    BillingGraceEndsAt: patch.billingGraceEndsAt || FieldValue.delete(),
    BillingDeletionReviewAt: patch.billingDeletionReviewAt || FieldValue.delete(),
    BillingAmountDue: patch.billingAmountDue || 0,
    BillingCurrency: patch.billingCurrency || "usd",
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function writeBillingPatch(db, clientId, business, patch) {
  const batch = db.batch();
  batch.set(db.collection("businesses").doc(clientId), patch, { merge: true });
  if (business.uid) batch.set(db.collection("accounts").doc(text(business.uid)), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), patch, { merge: true });
  batch.set(
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account"),
    mirroredBillingPatch(patch),
    { merge: true }
  );
  await batch.commit();
}

export async function registerPaymentFailure({
  db,
  clientId,
  eventId,
  invoiceId,
  amountDue = 0,
  currency = "usd",
  failedAt = Date.now(),
}) {
  const eventRef = db.collection("stripeWebhookEvents").doc(text(eventId));
  const eventSnapshot = await eventRef.get();
  if (eventSnapshot.exists) return { duplicate: true };

  const businessRef = db.collection("businesses").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) throw new Error("Stripe payment event does not match an ARK customer.");
  const business = businessSnapshot.data();

  const history = Array.isArray(business.billingOffenseHistory)
    ? business.billingOffenseHistory.map(Number).filter(Number.isFinite)
    : [];
  const recentHistory = history.filter((value) => value >= failedAt - SIX_MONTHS_MS);
  const continuingIncident = business.billingPastDue === true;
  const offenseNumber = continuingIncident
    ? Math.max(1, Number(business.billingOffenseNumber || recentHistory.length || 1))
    : recentHistory.length + 1;
  const nextHistory = continuingIncident ? recentHistory : [...recentHistory, failedAt];
  const quietEndsAt = failedAt + DAY_MS;
  const graceEndsAt = offenseNumber === 1 ? quietEndsAt + 7 * DAY_MS : quietEndsAt;
  const deletionReviewAt = offenseNumber >= 3 ? quietEndsAt : graceEndsAt + 7 * DAY_MS;

  const state = computeBillingState({
    billingPastDue: true,
    billingOffenseNumber: offenseNumber,
    billingFailureAt: Timestamp.fromMillis(failedAt),
    billingQuietEndsAt: Timestamp.fromMillis(quietEndsAt),
    billingGraceEndsAt: Timestamp.fromMillis(graceEndsAt),
    billingDeletionReviewAt: Timestamp.fromMillis(deletionReviewAt),
  }, failedAt);

  const patch = {
    billingPastDue: true,
    billingPhase: state.phase,
    serviceAccess: state.serviceAccess,
    billingDeletionReviewRequired: false,
    billingOffenseNumber: offenseNumber,
    billingOffenseHistory: nextHistory,
    billingFailureAt: Timestamp.fromMillis(failedAt),
    billingQuietEndsAt: Timestamp.fromMillis(quietEndsAt),
    billingGraceEndsAt: Timestamp.fromMillis(graceEndsAt),
    billingDeletionReviewAt: Timestamp.fromMillis(deletionReviewAt),
    billingInvoiceId: text(invoiceId),
    billingAmountDue: Math.max(0, Number(amountDue || 0)),
    billingCurrency: text(currency || "usd").toLowerCase(),
    billingLastEventId: text(eventId),
    billingResolvedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.create(eventRef, {
    type: "payment-failed",
    clientId,
    invoiceId: text(invoiceId),
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(businessRef, patch, { merge: true });
  if (business.uid) batch.set(db.collection("accounts").doc(text(business.uid)), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), patch, { merge: true });
  batch.set(
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account"),
    mirroredBillingPatch(patch),
    { merge: true }
  );
  await batch.commit();
  return { duplicate: false, offenseNumber, ...state };
}

export async function resolvePayment({ db, clientId, eventId, invoiceId = "" }) {
  const eventRef = db.collection("stripeWebhookEvents").doc(text(eventId));
  const eventSnapshot = await eventRef.get();
  if (eventSnapshot.exists) return { duplicate: true };

  const businessSnapshot = await db.collection("businesses").doc(clientId).get();
  if (!businessSnapshot.exists) return { ignored: true };
  const business = businessSnapshot.data();
  const patch = {
    billingPastDue: false,
    billingPhase: "current",
    serviceAccess: "full",
    billingDeletionReviewRequired: false,
    billingInvoiceId: text(invoiceId || business.billingInvoiceId),
    billingAmountDue: 0,
    billingResolvedAt: FieldValue.serverTimestamp(),
    billingFailureAt: FieldValue.delete(),
    billingQuietEndsAt: FieldValue.delete(),
    billingGraceEndsAt: FieldValue.delete(),
    billingDeletionReviewAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.create(eventRef, {
    type: "payment-resolved",
    clientId,
    invoiceId: text(invoiceId),
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("businesses").doc(clientId), patch, { merge: true });
  if (business.uid) batch.set(db.collection("accounts").doc(text(business.uid)), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), patch, { merge: true });
  batch.set(
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account"),
    mirroredBillingPatch(patch),
    { merge: true }
  );
  await batch.commit();
  return { duplicate: false, phase: "current" };
}

export async function syncBillingState(db, clientId, business, now = Date.now()) {
  const state = computeBillingState(business, now);
  const deletionReviewRequired = state.phase === "deletion-review";
  if (
    text(business.billingPhase) === state.phase
    && text(business.serviceAccess || "full") === state.serviceAccess
    && business.billingDeletionReviewRequired === deletionReviewRequired
  ) {
    return { ...state, changed: false };
  }

  const patch = {
    billingPhase: state.phase,
    serviceAccess: state.serviceAccess,
    billingDeletionReviewRequired: deletionReviewRequired,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await writeBillingPatch(db, clientId, business, patch);
  return { ...state, changed: true };
}
