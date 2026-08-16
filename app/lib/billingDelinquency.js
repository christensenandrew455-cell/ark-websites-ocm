import { FieldValue, Timestamp } from "firebase-admin/firestore";

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
  if (data.billingPastDue !== true && data.usageSuspended !== true) {
    return { phase: "current", restricted: false, showNotice: false, serviceAccess: "full", failureAt: 0, retryAt: 0, recoveryEndsAt: 0, reviewAt: 0 };
  }
  const failureAt = asMillis(data.billingFailureAt) || now;
  const retryAt = asMillis(data.billingNextRetryAt) || failureAt + PAYMENT_RETRY_INTERVAL_MS;
  const recoveryEndsAt = asMillis(data.billingDeleteAt) || failureAt + PAYMENT_RECOVERY_WINDOW_MS;
  const deletionDue = now >= recoveryEndsAt;
  return {
    phase: deletionDue ? "deletion_due" : "payment_failed",
    restricted: true,
    showNotice: true,
    serviceAccess: "payment-update-only",
    failureAt,
    retryAt,
    recoveryEndsAt,
    reviewAt: recoveryEndsAt,
  };
}

export function publicBillingStatus(data = {}, now = Date.now()) {
  const state = computeBillingState(data, now);
  const iso = (value) => value ? new Date(value).toISOString() : "";
  return {
    ...state,
    warning: state.showNotice ? "You need to update your payment method." : "",
    failureAt: iso(state.failureAt),
    retryAt: iso(state.retryAt),
    recoveryEndsAt: iso(state.recoveryEndsAt),
    reviewAt: iso(state.reviewAt),
  };
}

export async function findBusinessForStripeCustomer(db, customerId, metadata = {}) {
  const metadataClientId = text(metadata.clientId);
  if (metadataClientId) {
    const direct = await db.collection("businesses").doc(metadataClientId).get();
    if (direct.exists) return { clientId: direct.id, business: direct.data() };
  }
  if (!customerId) return null;
  const snapshot = await db.collection("businesses").where("stripeCustomerId", "==", customerId).limit(1).get();
  if (snapshot.empty) return null;
  return { clientId: snapshot.docs[0].id, business: snapshot.docs[0].data() };
}

function failureSettingsPatch(patch) {
  return {
    BillingStatus: "Payment method update needed",
    BillingPastDue: true,
    BillingPhase: patch.billingPhase,
    ServiceAccess: patch.serviceAccess,
    BillingFailureAt: patch.billingFailureAt,
    BillingNextRetryAt: patch.billingNextRetryAt,
    BillingDeleteAt: patch.billingDeleteAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function resolvedSettingsPatch() {
  return {
    BillingStatus: "Active",
    BillingPastDue: false,
    BillingPhase: "current",
    ServiceAccess: "full",
    BillingFailureAt: FieldValue.delete(),
    BillingNextRetryAt: FieldValue.delete(),
    BillingDeleteAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
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

export async function registerPaymentFailure({ db, clientId, eventId, invoiceId = "", failedAt = Date.now() }) {
  const safeEventId = text(eventId);
  if (!safeEventId) throw new Error("Stripe event ID is required.");
  const eventRef = db.collection("stripeWebhookEvents").doc(safeEventId);
  if ((await eventRef.get()).exists) return { duplicate: true };

  const businessRef = db.collection("businesses").doc(clientId);
  const connectionRef = db.collection("connections").doc(clientId);
  const receptionistRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist");
  const [businessSnapshot, connectionSnapshot, receptionistSnapshot] = await Promise.all([businessRef.get(), connectionRef.get(), receptionistRef.get()]);
  if (!businessSnapshot.exists) throw new Error("Stripe payment event does not match an ARK account.");
  const business = businessSnapshot.data();
  const continuing = business.billingPastDue === true || business.usageSuspended === true;
  const incidentFailureAt = continuing ? asMillis(business.billingFailureAt) || failedAt : failedAt;
  const deleteAt = continuing ? asMillis(business.billingDeleteAt) || incidentFailureAt + PAYMENT_RECOVERY_WINDOW_MS : incidentFailureAt + PAYMENT_RECOVERY_WINDOW_MS;
  const retryAt = Math.min(deleteAt, Math.max(Date.now(), failedAt) + PAYMENT_RETRY_INTERVAL_MS);
  const connection = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const receptionist = receptionistSnapshot.exists ? receptionistSnapshot.data() : {};
  const uid = text(business.uid || business.ownerUid);
  const patch = {
    status: "disabled",
    usageSuspended: true,
    billingPastDue: true,
    billingPhase: "payment_failed",
    serviceAccess: "payment-update-only",
    billingFailureAt: Timestamp.fromMillis(incidentFailureAt),
    billingNextRetryAt: Timestamp.fromMillis(retryAt),
    billingDeleteAt: Timestamp.fromMillis(deleteAt),
    billingInvoiceId: text(invoiceId),
    billingFailureKind: text(invoiceId).startsWith("pi_") || safeEventId.startsWith("usage-payment-failed-") ? "usage" : "subscription",
    billingLastEventId: safeEventId,
    billingWarning: "You need to update your payment method.",
    ...(!continuing ? {
      paymentFailurePreviousConnectionEnabled: connection.enabled !== false,
      paymentFailurePreviousReceptionistEnabled: receptionist.enabled !== false && connection.receptionistEnabled !== false,
    } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.create(eventRef, { type: "payment-failed", clientId, invoiceId: text(invoiceId), createdAt: FieldValue.serverTimestamp() });
  batch.set(businessRef, patch, { merge: true });
  if (uid) batch.set(db.collection("accounts").doc(uid), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), failureSettingsPatch(patch), { merge: true });
  batch.set(connectionRef, { enabled: false, receptionistEnabled: false, paymentDisabled: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(receptionistRef, { enabled: false, paymentDisabled: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  await setAccountClaimStatus(uid, "disabled").catch((error) => console.error("Unable to refresh disabled account claims", error));
  await sendBillingPush({ db, clientId, kind: "failed", eventId: safeEventId }).catch((error) => console.error("Unable to send payment failure notification", error));
  return { duplicate: false, ...computeBillingState(patch) };
}

export async function resolvePayment({ db, clientId, eventId, invoiceId = "" }) {
  const safeEventId = text(eventId);
  if (!safeEventId) throw new Error("Stripe event ID is required.");
  const eventRef = db.collection("stripeWebhookEvents").doc(safeEventId);
  if ((await eventRef.get()).exists) return { duplicate: true };
  const businessRef = db.collection("businesses").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) return { ignored: true };
  const business = businessSnapshot.data();
  const uid = text(business.uid || business.ownerUid);
  const connectionEnabled = business.paymentFailurePreviousConnectionEnabled !== false;
  const receptionistEnabled = business.paymentFailurePreviousReceptionistEnabled !== false;
  const patch = {
    status: "active",
    usageSuspended: false,
    billingPastDue: false,
    billingPhase: "current",
    serviceAccess: "full",
    billingInvoiceId: text(invoiceId || business.billingInvoiceId),
    billingFailureKind: FieldValue.delete(),
    billingResolvedAt: FieldValue.serverTimestamp(),
    billingWarning: FieldValue.delete(),
    billingFailureAt: FieldValue.delete(),
    billingNextRetryAt: FieldValue.delete(),
    billingDeleteAt: FieldValue.delete(),
    paymentFailurePreviousConnectionEnabled: FieldValue.delete(),
    paymentFailurePreviousReceptionistEnabled: FieldValue.delete(),
    lastPaymentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.create(eventRef, { type: "payment-resolved", clientId, invoiceId: text(invoiceId), createdAt: FieldValue.serverTimestamp() });
  batch.set(businessRef, patch, { merge: true });
  if (uid) batch.set(db.collection("accounts").doc(uid), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), resolvedSettingsPatch(), { merge: true });
  batch.set(db.collection("connections").doc(clientId), { enabled: connectionEnabled, receptionistEnabled, paymentDisabled: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist"), { enabled: receptionistEnabled, paymentDisabled: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  await setAccountClaimStatus(uid, "active").catch((error) => console.error("Unable to refresh restored account claims", error));
  await sendBillingPush({ db, clientId, kind: "restored", eventId: safeEventId }).catch((error) => console.error("Unable to send payment-restored notification", error));
  return { duplicate: false, phase: "current" };
}
