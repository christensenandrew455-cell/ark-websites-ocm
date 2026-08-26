import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { sendAdminEvent } from "./adminEvents.js";
import { systemCollection } from "./firestoreLayout.js";

export const PAYMENT_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const PAYMENT_RECOVERY_WINDOW_MS = 7 * PAYMENT_RETRY_INTERVAL_MS;

function text(value) { return String(value || "").trim(); }

export function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function computeBillingState(data = {}, now = Date.now()) {
  if (data.billingPastDue !== true) {
    return { phase: "current", restricted: false, showNotice: false, serviceAccess: "full", failureAt: 0, retryAt: 0, recoveryEndsAt: 0, reviewAt: 0 };
  }
  const failureAt = asMillis(data.billingFailureAt) || now;
  const retryAt = asMillis(data.billingNextRetryAt) || failureAt + PAYMENT_RETRY_INTERVAL_MS;
  const appleManagedRecovery = text(data.billingFailureProvider || data.billingProvider) === "apple";
  const recoveryEndsAt = appleManagedRecovery ? 0 : asMillis(data.billingDeleteAt) || failureAt + PAYMENT_RECOVERY_WINDOW_MS;
  const deletionDue = !appleManagedRecovery && now >= recoveryEndsAt;
  return {
    phase: deletionDue ? "deletion_due" : "payment_failed",
    restricted: true,
    showNotice: true,
    serviceAccess: "payment-update-only",
    failureAt,
    retryAt,
    recoveryEndsAt,
    reviewAt: recoveryEndsAt,
    appleManagedRecovery,
  };
}

export function publicBillingStatus(data = {}, now = Date.now()) {
  const state = computeBillingState(data, now);
  const iso = (value) => value ? new Date(value).toISOString() : "";
  return {
    ...state,
    billingProvider: text(data.billingProvider || "stripe"),
    usagePurchaseRequired: text(data.usageChargeStatus) === "purchase_required",
    warning: state.showNotice ? "You need to update your payment method." : "",
    failureAt: iso(state.failureAt),
    retryAt: iso(state.retryAt),
    recoveryEndsAt: iso(state.recoveryEndsAt),
    reviewAt: iso(state.reviewAt),
  };
}

function paymentEventCollection(db, provider) {
  return systemCollection(db, provider === "apple" ? "appleBillingEvents" : "stripeWebhookEvents");
}

export async function findBusinessForStripeCustomer(db, customerId, metadata = {}) {
  const metadataClientId = text(metadata.clientId);
  if (metadataClientId) {
    const direct = await db.collection("accounts").doc(metadataClientId).get();
    if (direct.exists) return { clientId: direct.id, business: direct.data() };
  }
  if (!customerId) return null;
  const snapshot = await db.collection("accounts").where("stripeCustomerId", "==", customerId).limit(1).get();
  if (snapshot.empty) return null;
  return { clientId: snapshot.docs[0].id, business: snapshot.docs[0].data() };
}

async function setAccountClaimStatus(uid, status) {
  if (!uid) return;
  const { getAdminAuth } = await import("./firebase-admin.js");
  const auth = getAdminAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), accountStatus: status });
}

async function sendBillingPush({ db, clientId, kind, eventId }) {
  const [{ PUSH_NOTIFICATION_COPY }, { sendAccountPushNotification }] = await Promise.all([
    import("./notificationCopy.js"),
    import("./notificationService.js"),
  ]);
  const failed = kind === "failed";
  return sendAccountPushNotification({
    db,
    clientId,
    notification: failed ? PUSH_NOTIFICATION_COPY.paymentFailed : PUSH_NOTIFICATION_COPY.paymentRestored,
    type: failed ? "payment-failed" : "payment-restored",
    eventId,
  });
}

export async function registerPaymentFailure({ db, clientId, eventId, invoiceId = "", failedAt = Date.now(), provider = "stripe" }) {
  const safeEventId = text(eventId);
  const safeProvider = provider === "apple" ? "apple" : "stripe";
  if (!safeEventId) throw new Error("Payment event ID is required.");
  const eventRef = paymentEventCollection(db, safeProvider).doc(safeEventId);
  if ((await eventRef.get()).exists) return { duplicate: true };

  const businessRef = db.collection("accounts").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) throw new Error("Payment event does not match an ARK account.");
  const business = businessSnapshot.data();
  const continuing = business.billingPastDue === true;
  const appleManagedRecovery = safeProvider === "apple";
  const incidentFailureAt = continuing ? asMillis(business.billingFailureAt) || failedAt : failedAt;
  const deleteAt = appleManagedRecovery ? 0 : continuing ? asMillis(business.billingDeleteAt) || incidentFailureAt + PAYMENT_RECOVERY_WINDOW_MS : incidentFailureAt + PAYMENT_RECOVERY_WINDOW_MS;
  const retryAt = appleManagedRecovery
    ? Math.max(Date.now(), failedAt) + PAYMENT_RETRY_INTERVAL_MS
    : Math.min(deleteAt, Math.max(Date.now(), failedAt) + PAYMENT_RETRY_INTERVAL_MS);
  const uid = text(business.uid);
  const patch = {
    status: "disabled",
    billingPastDue: true,
    billingFailureAt: Timestamp.fromMillis(incidentFailureAt),
    billingNextRetryAt: Timestamp.fromMillis(retryAt),
    billingDeleteAt: appleManagedRecovery ? FieldValue.delete() : Timestamp.fromMillis(deleteAt),
    billingInvoiceId: text(invoiceId),
    billingFailureProvider: safeProvider,
    billingFailureKind: text(invoiceId).startsWith("pi_") || safeEventId.startsWith("usage-payment-failed-") ? "usage" : "subscription",
    billingLastEventId: safeEventId,
    enabled: false,
    receptionistEnabled: false,
    ...(!continuing ? {
      paymentFailurePreviousConnectionEnabled: business.enabled !== false,
      paymentFailurePreviousReceptionistEnabled: business.receptionistEnabled !== false,
    } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.create(eventRef, { type: "payment-failed", provider: safeProvider, clientId, invoiceId: text(invoiceId), createdAt: FieldValue.serverTimestamp() });
  batch.set(businessRef, patch, { merge: true });
  await batch.commit();
  await setAccountClaimStatus(uid, "disabled").catch((error) => console.error("Unable to refresh disabled account claims", error));
  await sendBillingPush({ db, clientId, kind: "failed", eventId: safeEventId }).catch((error) => console.error("Unable to send payment failure notification", error));
  await sendAdminEvent({
    id: `billing-failed-${safeEventId}`,
    type: "billing.payment_failed",
    clientId,
    businessName: text(business.businessName || clientId),
    summary: "Payment failed; customer service was paused",
    metadata: { provider: safeProvider, invoiceId: text(invoiceId), retryAt: new Date(retryAt).toISOString(), deleteAt: deleteAt ? new Date(deleteAt).toISOString() : "apple-managed" },
  });
  return { duplicate: false, ...computeBillingState(patch) };
}

export async function resolvePayment({ db, clientId, eventId, invoiceId = "", provider = "stripe" }) {
  const safeEventId = text(eventId);
  const safeProvider = provider === "apple" ? "apple" : "stripe";
  if (!safeEventId) throw new Error("Payment event ID is required.");
  const eventRef = paymentEventCollection(db, safeProvider).doc(safeEventId);
  if ((await eventRef.get()).exists) return { duplicate: true };
  const businessRef = db.collection("accounts").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) return { ignored: true };
  const business = businessSnapshot.data();
  const uid = text(business.uid);
  const connectionEnabled = business.paymentFailurePreviousConnectionEnabled !== false;
  const receptionistEnabled = business.paymentFailurePreviousReceptionistEnabled !== false;
  const patch = {
    status: "active",
    billingPastDue: false,
    billingInvoiceId: text(invoiceId || business.billingInvoiceId),
    billingFailureKind: FieldValue.delete(),
    billingFailureProvider: FieldValue.delete(),
    billingResolvedAt: FieldValue.serverTimestamp(),
    billingFailureAt: FieldValue.delete(),
    billingNextRetryAt: FieldValue.delete(),
    billingDeleteAt: FieldValue.delete(),
    paymentFailurePreviousConnectionEnabled: FieldValue.delete(),
    paymentFailurePreviousReceptionistEnabled: FieldValue.delete(),
    enabled: connectionEnabled,
    receptionistEnabled,
    lastPaymentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.create(eventRef, { type: "payment-resolved", provider: safeProvider, clientId, invoiceId: text(invoiceId), createdAt: FieldValue.serverTimestamp() });
  batch.set(businessRef, patch, { merge: true });
  await batch.commit();
  await setAccountClaimStatus(uid, "active").catch((error) => console.error("Unable to refresh restored account claims", error));
  await sendBillingPush({ db, clientId, kind: "restored", eventId: safeEventId }).catch((error) => console.error("Unable to send payment-restored notification", error));
  await sendAdminEvent({
    id: `billing-restored-${safeEventId}`,
    type: "billing.payment_restored",
    clientId,
    businessName: text(business.businessName || clientId),
    summary: "Payment succeeded; customer service was restored",
    metadata: { provider: safeProvider, invoiceId: text(invoiceId || business.billingInvoiceId) },
  });
  return { duplicate: false, phase: "current" };
}
