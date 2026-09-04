import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { sendAdminEvent } from "./adminEvents.js";
import { applePlanForProduct } from "./appleIapCatalog.js";
import { systemCollection } from "./firestoreLayout.js";

const REVENUE_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const REVENUE_SYNC_LOCK_MS = 10 * 60 * 1000;

function text(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function whole(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return Number(value.seconds) * 1000;
  if (typeof value === "number") return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function stripeId(value) {
  return text(typeof value === "string" ? value : value?.id, 180);
}

function safeEventId(value) {
  return text(value, 180).replace(/[^a-z0-9_-]/gi, "-");
}

export function revenuePaymentEventId({ provider, paymentKind, paymentId }) {
  const safeProvider = text(provider, 20).toLowerCase();
  const safePaymentId = safeEventId(paymentId);
  if (!safePaymentId) return "";
  if (text(paymentKind, 60) === "accepted_lead_top_up") {
    return `billing-paid-${safeProvider || "payment"}-lead-top-up-${safePaymentId}`;
  }
  if (safeProvider === "apple") return `billing-paid-apple-${safePaymentId}`;
  return `billing-paid-${safePaymentId}`;
}

export function normalizeRevenuePayment(payment = {}) {
  const provider = text(payment.provider, 20).toLowerCase();
  const paymentId = text(payment.paymentId, 180);
  const paymentKind = text(payment.paymentKind || "payment", 60).toLowerCase();
  const clientId = text(payment.clientId, 180);
  const amountCents = whole(payment.amountCents);
  const currency = text(payment.currency || "usd", 10).toLowerCase();
  const paidAtMs = timestampMillis(payment.paidAt) || Date.now();
  const eventId = safeEventId(payment.eventId)
    || revenuePaymentEventId({ provider, paymentKind, paymentId });
  if (!eventId || !clientId || !paymentId || !["stripe", "apple"].includes(provider)
    || amountCents <= 0 || !/^[a-z]{3}$/.test(currency)) return null;
  return {
    eventId,
    provider,
    paymentId,
    paymentKind,
    clientId,
    businessName: text(payment.businessName || clientId, 180),
    amountCents,
    currency,
    paidAt: new Date(paidAtMs).toISOString(),
  };
}

export async function recordRevenuePayment({ db, source = "ark-client-center-ledger", ...payment }) {
  if (!db) throw new Error("REVENUE_LEDGER_DB_REQUIRED");
  const normalized = normalizeRevenuePayment(payment);
  if (!normalized) return { recorded: false, skipped: true };
  const { eventId, ...document } = normalized;
  await systemCollection(db, "paymentEvents").doc(eventId).set({
    ...document,
    source: text(source, 80) || "ark-client-center-ledger",
    receivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { recorded: true, eventId, payment: normalized };
}

export async function readRevenueLedgerPayments(db) {
  if (!db) throw new Error("REVENUE_LEDGER_DB_REQUIRED");
  const snapshot = await systemCollection(db, "paymentEvents").get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return normalizeRevenuePayment({
      ...data,
      eventId: document.id,
      provider: data.provider || (document.id.startsWith("billing-paid-apple-") ? "apple" : "stripe"),
    });
  }).filter(Boolean);
}

export async function reportRevenuePayment({ db, summary = "Customer payment succeeded", metadata = {}, ...payment }) {
  const normalized = normalizeRevenuePayment(payment);
  if (!normalized) return { recorded: false, skipped: true };
  // Let Admin calculate milestone notifications before the shared ledger makes
  // this deterministic event ID look like an already-processed payment.
  const delivery = await sendAdminEvent({
    id: normalized.eventId,
    type: "billing.payment_succeeded",
    clientId: normalized.clientId,
    businessName: normalized.businessName,
    summary: text(summary, 700),
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      paymentId: normalized.paymentId,
      paymentKind: normalized.paymentKind,
      provider: normalized.provider,
      amountCents: normalized.amountCents,
      currency: normalized.currency,
    },
    occurredAt: normalized.paidAt,
  });
  const ledger = await recordRevenuePayment({
    db,
    ...normalized,
    source: delivery.delivered ? "ark-client-center-webhook-and-ledger" : "ark-client-center-ledger",
  });
  return { ...ledger, delivery };
}

function stripeInvoiceMetadata(invoice) {
  return {
    ...(invoice?.subscription_details?.metadata || {}),
    ...(invoice?.parent?.subscription_details?.metadata || {}),
    ...(invoice?.metadata || {}),
  };
}

function accountIdentity(account = {}, fallbackClientId = "", fallbackBusinessName = "") {
  const clientId = text(account.clientId || fallbackClientId, 180);
  return {
    clientId,
    businessName: text(account.businessName || fallbackBusinessName || clientId, 180),
  };
}

export function stripeInvoiceRevenuePayment(invoice, account = {}) {
  const metadata = stripeInvoiceMetadata(invoice);
  const identity = accountIdentity(account, metadata.clientId, metadata.businessName);
  const paymentId = text(invoice?.id, 180);
  const amountCents = whole(invoice?.amount_paid);
  if (text(invoice?.status).toLowerCase() !== "paid" || !identity.clientId || !paymentId || !amountCents) return null;
  return normalizeRevenuePayment({
    provider: "stripe",
    paymentId,
    paymentKind: stripeId(invoice?.subscription || invoice?.parent?.subscription_details?.subscription) ? "subscription" : "invoice",
    clientId: identity.clientId,
    businessName: identity.businessName,
    amountCents,
    currency: invoice?.currency,
    paidAt: Number(invoice?.status_transitions?.paid_at || invoice?.created || 0) * 1000,
  });
}

export function stripeTopUpRevenuePayment(paymentIntent, account = {}) {
  const metadata = paymentIntent?.metadata || {};
  if (text(metadata.purpose) !== "accepted_lead_top_up" || text(paymentIntent?.status) !== "succeeded") return null;
  const identity = accountIdentity(account, metadata.clientId, metadata.businessName);
  if (!identity.clientId) return null;
  return normalizeRevenuePayment({
    provider: "stripe",
    paymentId: paymentIntent?.id,
    paymentKind: "accepted_lead_top_up",
    clientId: identity.clientId,
    businessName: identity.businessName,
    amountCents: paymentIntent?.amount_received,
    currency: paymentIntent?.currency,
    paidAt: Number(paymentIntent?.created || 0) * 1000,
  });
}

export function appleTransactionRevenuePayment(transactionId, transaction = {}, account = {}) {
  const identity = accountIdentity(account, transaction.clientId, transaction.businessName);
  const plan = applePlanForProduct(transaction.productId);
  return normalizeRevenuePayment({
    provider: "apple",
    paymentId: transactionId,
    paymentKind: "subscription",
    clientId: identity.clientId,
    businessName: identity.businessName,
    amountCents: whole(transaction.amountCents) || whole(plan?.amountCents),
    currency: transaction.currency || "usd",
    paidAt: transaction.purchaseDate,
  });
}

export function acceptedLeadTopUpRevenuePayment(receipt = {}, account = {}) {
  const identity = accountIdentity(account, receipt.clientId, receipt.businessName);
  return normalizeRevenuePayment({
    provider: receipt.provider,
    paymentId: receipt.paymentId,
    paymentKind: "accepted_lead_top_up",
    clientId: identity.clientId,
    businessName: identity.businessName,
    amountCents: receipt.amountCents,
    currency: receipt.currency,
    paidAt: receipt.purchasedAt,
  });
}

async function listStripeObjects(listPage) {
  const items = [];
  let startingAfter = "";
  do {
    const page = await listPage(startingAfter);
    const pageItems = Array.isArray(page?.data) ? page.data : [];
    items.push(...pageItems);
    startingAfter = page?.has_more && pageItems.length ? text(pageItems.at(-1)?.id, 180) : "";
  } while (startingAfter);
  return items;
}

async function beginRevenueSync(db, { force, now }) {
  const stateRef = systemCollection(db, "revenueSyncState").doc("ledger");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    const state = snapshot.exists ? snapshot.data() : {};
    const lastCompletedAt = timestampMillis(state.lastCompletedAt);
    const lockedAt = timestampMillis(state.lockedAt);
    if (!force && lastCompletedAt && now - lastCompletedAt < REVENUE_SYNC_INTERVAL_MS) {
      return { started: false, reason: "fresh", lastCompletedAt: new Date(lastCompletedAt).toISOString() };
    }
    if (lockedAt && now - lockedAt < REVENUE_SYNC_LOCK_MS) {
      return { started: false, reason: "running", lastCompletedAt: lastCompletedAt ? new Date(lastCompletedAt).toISOString() : "" };
    }
    transaction.set(stateRef, {
      status: "running",
      lockedAt: Timestamp.fromMillis(now),
      lastStartedAt: Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { started: true, stateRef };
  });
}

export async function syncRevenueLedger({ db, stripe = null, force = false, includePayments = false, now = Date.now() }) {
  if (!db) throw new Error("REVENUE_LEDGER_DB_REQUIRED");
  const started = await beginRevenueSync(db, { force, now });
  if (!started.started) {
    const payments = includePayments ? await readRevenueLedgerPayments(db) : undefined;
    return { ok: true, skipped: true, reason: started.reason, lastCompletedAt: started.lastCompletedAt, payments };
  }

  try {
    const accountsSnapshot = await db.collection("accounts").get();
    const byClientId = new Map();
    const byStripeCustomerId = new Map();
    accountsSnapshot.docs.forEach((document) => {
      const account = { clientId: document.id, ...document.data() };
      byClientId.set(text(account.clientId), account);
      const customerId = text(account.stripeCustomerId);
      if (customerId) byStripeCustomerId.set(customerId, account);
    });

    const [invoices, paymentIntents, appleSnapshot, topUpSnapshot] = await Promise.all([
      stripe ? listStripeObjects((startingAfter) => stripe.invoices.list({ status: "paid", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) })) : [],
      stripe ? listStripeObjects((startingAfter) => stripe.paymentIntents.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) })) : [],
      systemCollection(db, "appleTransactions").get(),
      systemCollection(db, "acceptedLeadTopUpPayments").get(),
    ]);

    const payments = [];
    invoices.forEach((invoice) => {
      const metadata = stripeInvoiceMetadata(invoice);
      const account = byStripeCustomerId.get(stripeId(invoice.customer)) || byClientId.get(text(metadata.clientId)) || {};
      const payment = stripeInvoiceRevenuePayment(invoice, account);
      if (payment) payments.push(payment);
    });
    paymentIntents.forEach((paymentIntent) => {
      const account = byStripeCustomerId.get(stripeId(paymentIntent.customer))
        || byClientId.get(text(paymentIntent?.metadata?.clientId)) || {};
      const payment = stripeTopUpRevenuePayment(paymentIntent, account);
      if (payment) payments.push(payment);
    });
    appleSnapshot.docs.forEach((document) => {
      const data = document.data();
      const payment = appleTransactionRevenuePayment(document.id, data, byClientId.get(text(data.clientId)) || {});
      if (payment) payments.push(payment);
    });
    topUpSnapshot.docs.forEach((document) => {
      const data = document.data();
      const payment = acceptedLeadTopUpRevenuePayment(data, byClientId.get(text(data.clientId)) || {});
      if (payment) payments.push(payment);
    });

    // Provider history and a saved receipt can describe the same charge. The
    // deterministic event ID makes that one ledger row, never two entries.
    const uniquePayments = [...new Map(payments.map((payment) => [payment.eventId, payment])).values()];
    for (const payment of uniquePayments) {
      await recordRevenuePayment({ db, ...payment, source: "ark-client-center-reconciliation" });
    }
    const completedAt = Date.now();
    await started.stateRef.set({
      status: "idle",
      lockedAt: FieldValue.delete(),
      lastCompletedAt: Timestamp.fromMillis(completedAt),
      lastError: FieldValue.delete(),
      paymentsFound: uniquePayments.length,
      stripeInvoicesChecked: invoices.length,
      stripePaymentIntentsChecked: paymentIntents.length,
      appleTransactionsChecked: appleSnapshot.size,
      topUpsChecked: topUpSnapshot.size,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const ledgerPayments = includePayments ? await readRevenueLedgerPayments(db) : undefined;
    return {
      ok: true,
      skipped: false,
      paymentsFound: uniquePayments.length,
      lastCompletedAt: new Date(completedAt).toISOString(),
      payments: ledgerPayments,
    };
  } catch (error) {
    await started.stateRef.set({
      status: "error",
      lockedAt: FieldValue.delete(),
      lastError: text(error?.message || error, 300),
      lastFailedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    throw error;
  }
}
