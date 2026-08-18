import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import Stripe from "stripe";
import { isStandardRole } from "./accountRoles.js";
import { sendAdminEvent } from "./adminEvents.js";
import { ACCEPTED_LEAD_BILLING_SOURCE } from "./billingLeadUsage.js";
import {
  smsUsageResult,
  USAGE_CHARGE_THRESHOLD_POINTS,
  USAGE_POINT_CENTS,
  usageChargeAfterReferralDiscount,
} from "./billingPricing.js";
import { PAYMENT_RETRY_INTERVAL_MS, registerPaymentFailure, resolvePayment } from "./billingDelinquency.js";
import { ensureStripeUsagePrice } from "./stripeUsageBilling.js";
import { activeReferralSavings } from "./referrals.js";

const PROCESSING_LOCK_MS = 5 * 60 * 1000;
const ACCEPTED_LEAD_USAGE_CORRECTION_VERSION = 1;
const NON_ACCEPTED_LEAD_VOID_REASON = "lead-not-accepted";

function text(value) { return String(value || "").trim(); }
function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}
function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
export function usageEventDocumentId(clientId, type, sourceId) {
  return createHash("sha256").update(`${text(clientId)}:${text(type)}:${text(sourceId)}`).digest("hex").slice(0, 48);
}
function correctedChargeStatus(status, balancePoints) {
  const current = text(status);
  if (["processing", "retry_pending", "declined"].includes(current)) return current;
  return balancePoints >= USAGE_CHARGE_THRESHOLD_POINTS ? "pending" : "idle";
}
async function requireAcceptedLeadLedger(ledgerRef, sourceId) {
  if (!ledgerRef || text(ledgerRef.id) !== text(sourceId)) throw new Error("LEAD_ACCEPTANCE_REQUIRED");
  const snapshot = await ledgerRef.get();
  if (!snapshot.exists || text(snapshot.data().sourceType) !== ACCEPTED_LEAD_BILLING_SOURCE) {
    throw new Error("LEAD_ACCEPTANCE_REQUIRED");
  }
}
function stripeClient(stripe) {
  if (stripe) return stripe;
  return process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
}
function paymentDeclined(error) {
  const type = text(error?.type || error?.rawType).toLowerCase();
  const code = text(error?.code || error?.raw?.code).toLowerCase();
  const status = text(error?.payment_intent?.status || error?.raw?.payment_intent?.status).toLowerCase();
  return type.includes("card") || ["card_declined", "authentication_required", "payment_intent_authentication_failure"].includes(code) || ["requires_action", "requires_payment_method", "canceled"].includes(status);
}

export async function recordUsage({ db, stripe = null, clientId, type, sourceId, points = 0, smsParts = 0, occurredAt = Date.now(), ledgerRef = null }) {
  const safeClientId = text(clientId);
  const safeType = text(type);
  const safeSourceId = text(sourceId);
  if (!safeClientId || !safeType || !safeSourceId) throw new Error("USAGE_EVENT_INVALID");
  if (safeType === "lead") {
    await requireAcceptedLeadLedger(ledgerRef, safeSourceId);
    await reconcileNonAcceptedLeadUsage({ db, clientId: safeClientId });
  }
  const accountRef = db.collection("accounts").doc(safeClientId);
  const usageEventRef = accountRef.collection("usageEvents").doc(usageEventDocumentId(safeClientId, safeType, safeSourceId));
  const result = await db.runTransaction(async (transaction) => {
    const [accountSnapshot, existingEvent] = await Promise.all([transaction.get(accountRef), transaction.get(usageEventRef)]);
    if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    const account = accountSnapshot.data();
    if (!text(account.uid)) throw new Error("ACCOUNT_NOT_FOUND");
    if (existingEvent.exists) {
      if (ledgerRef) transaction.set(ledgerRef, { usageRecorded: true, usageRecordedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { duplicate: true, balancePoints: whole(account.usageBalancePoints) };
    }
    if (account.status !== "active" || account.billingPastDue === true) throw new Error("ACCOUNT_USAGE_SUSPENDED");

    const smsUsage = smsUsageResult(account.usageSmsPartRemainder, smsParts);
    const smsPoints = smsUsage.addedPoints;
    const nextSmsRemainder = smsUsage.remainderParts;
    const addedPoints = whole(points) + smsPoints;
    const nextBalance = whole(account.usageBalancePoints) + addedPoints;
    const currentChargeStatus = text(account.usageChargeStatus);
    const chargeAlreadyClaimed = ["processing", "retry_pending", "declined"].includes(currentChargeStatus);
    transaction.create(usageEventRef, {
      type: safeType,
      sourceIdHash: createHash("sha256").update(safeSourceId).digest("hex"),
      points: addedPoints,
      smsParts: whole(smsParts),
      occurredAt: Timestamp.fromMillis(Math.max(1, Number(occurredAt) || Date.now())),
      createdAt: FieldValue.serverTimestamp(),
    });
    if (ledgerRef) transaction.set(ledgerRef, { usageRecorded: true, usageRecordedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(accountRef, {
      usageBalancePoints: nextBalance,
      usageSmsPartRemainder: nextSmsRemainder,
      usageChargeStatus: nextBalance >= USAGE_CHARGE_THRESHOLD_POINTS && !chargeAlreadyClaimed ? "pending" : currentChargeStatus || "idle",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { duplicate: false, addedPoints, smsPoints, balancePoints: nextBalance, smsPartRemainder: nextSmsRemainder };
  });

  if (result.balancePoints >= USAGE_CHARGE_THRESHOLD_POINTS) {
    const payment = await settleUsageThreshold({ db, stripe, clientId: safeClientId });
    return { ...result, payment };
  }
  return result;
}

export function recordLeadUsage(options) {
  return recordUsage({ ...options, type: "lead", points: 2 });
}

export function recordChatUsage(options) {
  return recordUsage({ ...options, type: "chat", points: 0 });
}

export function recordSmsPartUsage(options) {
  return recordUsage({ ...options, type: "sms-parts", points: 0 });
}

async function voidNonAcceptedLeadUsageEvent({ db, accountRef, usageEventRef }) {
  return db.runTransaction(async (transaction) => {
    const [accountSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(usageEventRef),
    ]);
    if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    if (!eventSnapshot.exists) return { voided: false, points: 0, balancePointsRemoved: 0 };

    const event = eventSnapshot.data();
    if (text(event.type) !== "lead" || event.voided === true) {
      return { voided: false, points: 0, balancePointsRemoved: 0 };
    }

    const account = accountSnapshot.data();
    const points = whole(event.points);
    const currentBalance = whole(account.usageBalancePoints);
    const nextBalance = Math.max(0, currentBalance - points);
    const balancePointsRemoved = currentBalance - nextBalance;
    transaction.set(usageEventRef, {
      voided: true,
      voidReason: NON_ACCEPTED_LEAD_VOID_REASON,
      voidedPoints: points,
      balancePointsRemoved,
      voidedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(accountRef, {
      usageBalancePoints: nextBalance,
      usageChargeStatus: correctedChargeStatus(account.usageChargeStatus, nextBalance),
      nonAcceptedLeadPointsVoided: whole(account.nonAcceptedLeadPointsVoided) + points,
      nonAcceptedLeadBalancePointsRemoved: whole(account.nonAcceptedLeadBalancePointsRemoved) + balancePointsRemoved,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { voided: true, points, balancePointsRemoved };
  });
}

export async function reconcileNonAcceptedLeadUsage({ db, clientId, force = false } = {}) {
  const safeClientId = text(clientId);
  if (!safeClientId) throw new Error("ACCOUNT_NOT_FOUND");
  const accountRef = db.collection("accounts").doc(safeClientId);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
  const account = accountSnapshot.data();
  if (!force && whole(account.acceptedLeadUsageCorrectionVersion) >= ACCEPTED_LEAD_USAGE_CORRECTION_VERSION) {
    return {
      skipped: true,
      checked: 0,
      voided: 0,
      pointsVoided: 0,
      balancePointsRemoved: 0,
      balancePoints: whole(account.usageBalancePoints),
    };
  }

  // Read usage first and accepted ledgers second. An acceptance writes its ledger
  // before its usage event, so this order cannot mistake a concurrent acceptance
  // for a legacy call or unaccepted intake event.
  const usageSnapshot = await accountRef.collection("usageEvents").where("type", "==", "lead").get();
  const acceptedLedgerSnapshot = await accountRef.collection("billingLeadEvents")
    .where("sourceType", "==", ACCEPTED_LEAD_BILLING_SOURCE)
    .get();
  const acceptedUsageEventIds = new Set(
    acceptedLedgerSnapshot.docs.map((document) => usageEventDocumentId(safeClientId, "lead", document.id)),
  );
  const candidates = usageSnapshot.docs.filter((document) => (
    document.data().voided !== true && !acceptedUsageEventIds.has(document.id)
  ));

  const result = {
    skipped: false,
    checked: usageSnapshot.size,
    voided: 0,
    pointsVoided: 0,
    balancePointsRemoved: 0,
    balancePoints: whole(account.usageBalancePoints),
  };
  for (const document of candidates) {
    const correction = await voidNonAcceptedLeadUsageEvent({
      db,
      accountRef,
      usageEventRef: document.ref,
    });
    if (!correction.voided) continue;
    result.voided += 1;
    result.pointsVoided += correction.points;
    result.balancePointsRemoved += correction.balancePointsRemoved;
  }

  await accountRef.set({
    acceptedLeadUsageCorrectionVersion: ACCEPTED_LEAD_USAGE_CORRECTION_VERSION,
    acceptedLeadUsageCorrectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const correctedAccount = await accountRef.get();
  result.balancePoints = whole(correctedAccount.data()?.usageBalancePoints);
  return result;
}

export async function reconcileNonAcceptedLeadUsageBalances({ db, maximumBusinesses = 100, force = true } = {}) {
  const businesses = await db.collection("accounts").where("status", "==", "active").limit(Math.max(1, maximumBusinesses)).get();
  const results = { businesses: businesses.size, checked: 0, corrected: 0, pointsVoided: 0, balancePointsRemoved: 0, failed: 0 };
  for (const business of businesses.docs) {
    if (!isStandardRole(business.data().role)) continue;
    try {
      const correction = await reconcileNonAcceptedLeadUsage({ db, clientId: business.id, force });
      results.checked += 1;
      if (correction.voided > 0) results.corrected += 1;
      results.pointsVoided += correction.pointsVoided;
      results.balancePointsRemoved += correction.balancePointsRemoved;
    } catch (error) {
      results.failed += 1;
      console.error(`Unable to correct non-accepted lead usage for ${business.id}`, error);
    }
  }
  return results;
}

async function pendingLedgerDocuments(root, collectionName, maximum) {
  if (maximum <= 0) return [];
  const snapshot = await root.collection(collectionName).where("usageRecorded", "==", false).limit(maximum).get();
  return snapshot.docs;
}

export async function reconcilePendingUsageEvents({ db, stripe = null, maximumBusinesses = 100, maximumEvents = 500 } = {}) {
  const businesses = await db.collection("accounts").where("status", "==", "active").limit(Math.max(1, maximumBusinesses)).get();
  const results = { businesses: businesses.size, checked: 0, recorded: 0, skipped: 0, failed: 0 };
  for (const business of businesses.docs) {
    if (!isStandardRole(business.data().role)) continue;
    if (results.checked >= maximumEvents) break;
    const root = db.collection("accounts").doc(business.id);
    const remaining = () => Math.max(0, maximumEvents - results.checked);
    const ledgers = [
      { collection: "billingLeadEvents", type: "lead", points: 2, sms: false },
      { collection: "billingConversationEvents", type: "chat", points: 0, sms: false },
      { collection: "billingMessageEvents", type: "sms-parts", points: 0, sms: true },
    ];
    for (const ledger of ledgers) {
      const documents = await pendingLedgerDocuments(root, ledger.collection, remaining());
      for (const document of documents) {
        results.checked += 1;
        try {
          const data = document.data();
          if (ledger.type === "lead" && text(data.sourceType) !== ACCEPTED_LEAD_BILLING_SOURCE) {
            await document.ref.set({
              usageRecorded: true,
              usageRecordedAt: FieldValue.serverTimestamp(),
              usageSkippedReason: "lead-not-accepted",
            }, { merge: true });
            results.skipped += 1;
            continue;
          }
          await recordUsage({
            db,
            stripe,
            clientId: business.id,
            type: ledger.type,
            sourceId: document.id,
            points: ledger.points,
            smsParts: ledger.sms ? whole(data.smsParts) : 0,
            occurredAt: millis(data.occurredAt || data.createdAt) || Date.now(),
            ledgerRef: document.ref,
          });
          results.recorded += 1;
        } catch (error) {
          results.failed += 1;
          if (text(error?.message) !== "ACCOUNT_USAGE_SUSPENDED") console.error(`Unable to reconcile ${document.ref.path}`, error);
        }
      }
    }
  }
  return results;
}

async function claimCharge(db, clientId, now = Date.now()) {
  const accountRef = db.collection("accounts").doc(clientId);
  const referralSavings = await activeReferralSavings({ db, clientId, now });
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(accountRef);
    if (!snapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    const account = snapshot.data();
    const balance = whole(account.usageBalancePoints);
    if (balance < USAGE_CHARGE_THRESHOLD_POINTS) return null;
    const status = text(account.usageChargeStatus);
    const attemptedAt = millis(account.usageChargeAttemptedAt);
    const retryAt = millis(account.billingNextRetryAt);
    if (status === "processing" && attemptedAt && now - attemptedAt < PROCESSING_LOCK_MS) return null;
    if ((status === "declined" || account.billingPastDue === true) && retryAt > now) return null;
    const reuseSequence = ["processing", "retry_pending"].includes(status) && whole(account.usageChargeSequence) > 0;
    const sequence = reuseSequence ? whole(account.usageChargeSequence) : whole(account.usageChargeSequence) + 1;
    const customerId = reuseSequence ? text(account.usageChargeCustomerId || account.stripeCustomerId) : text(account.stripeCustomerId);
    const paymentMethodId = reuseSequence ? text(account.usageChargePaymentMethodId || account.stripePaymentMethodId) : text(account.stripePaymentMethodId);
    const fullAmountCents = USAGE_CHARGE_THRESHOLD_POINTS * USAGE_POINT_CENTS;
    const discountPercent = reuseSequence
      ? whole(account.usageChargeReferralDiscountPercent)
      : referralSavings.percent;
    const amountCents = reuseSequence
      ? whole(account.usageChargeAmountCents) || fullAmountCents
      : usageChargeAfterReferralDiscount(fullAmountCents, discountPercent);
    transaction.set(accountRef, {
      usageChargeStatus: "processing",
      usageChargeSequence: sequence,
      usageChargeCustomerId: customerId,
      usageChargePaymentMethodId: paymentMethodId,
      usageChargeAmountCents: amountCents,
      usageChargeReferralDiscountPercent: discountPercent,
      usageChargeAttemptedAt: Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      uid: text(account.uid),
      clientId: text(account.clientId || clientId),
      businessName: text(account.businessName || account.clientId || clientId),
      sequence,
      balance,
      customerId,
      paymentMethodId,
      amountCents,
      referralDiscountPercent: discountPercent,
      wasSuspended: account.billingPastDue === true,
    };
  });
}

async function markTransientFailure(db, claim, error) {
  await db.collection("accounts").doc(claim.clientId).set({
    // Keep the same sequence and payment details so Stripe's idempotency key
    // safely resolves an attempt whose network outcome was unknown.
    usageChargeStatus: "retry_pending",
    usageChargeLastError: text(error?.code || error?.message).slice(0, 200),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function markDeclined(db, claim, paymentIntentId, error) {
  const now = Date.now();
  await db.collection("accounts").doc(claim.clientId).set({
    usageChargeStatus: "declined",
    usageChargeLastPaymentIntentId: text(paymentIntentId),
    usageChargeLastError: text(error?.code || error?.message || "payment_declined").slice(0, 200),
    usageChargeCustomerId: FieldValue.delete(),
    usageChargePaymentMethodId: FieldValue.delete(),
    usageChargeAmountCents: FieldValue.delete(),
    usageChargeReferralDiscountPercent: FieldValue.delete(),
    billingNextRetryAt: Timestamp.fromMillis(now + PAYMENT_RETRY_INTERVAL_MS),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await registerPaymentFailure({
    db,
    clientId: claim.clientId,
    eventId: `usage-payment-failed-${claim.uid}-${claim.sequence}`,
    invoiceId: text(paymentIntentId),
    failedAt: now,
  });
}

async function markPaid(db, claim, paymentIntent) {
  const accountRef = db.collection("accounts").doc(claim.clientId);
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(accountRef);
    if (!snapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    const account = snapshot.data();
    if (whole(account.usageChargeSequence) !== claim.sequence) return { balancePoints: whole(account.usageBalancePoints), stale: true };
    const nextBalance = Math.max(0, whole(account.usageBalancePoints) - USAGE_CHARGE_THRESHOLD_POINTS);
    transaction.set(accountRef, {
      usageBalancePoints: nextBalance,
      usageChargeStatus: nextBalance >= USAGE_CHARGE_THRESHOLD_POINTS ? "pending" : "idle",
      usageChargeLastPaymentIntentId: text(paymentIntent.id),
      usageChargeLastError: FieldValue.delete(),
      usageChargeCustomerId: FieldValue.delete(),
      usageChargePaymentMethodId: FieldValue.delete(),
      usageChargeAmountCents: FieldValue.delete(),
      usageChargeReferralDiscountPercent: FieldValue.delete(),
      usageChargeAttemptedAt: FieldValue.delete(),
      lastUsageChargeAmountCents: claim.amountCents,
      lastUsageReferralDiscountPercent: claim.referralDiscountPercent,
      lastUsagePaymentAt: FieldValue.serverTimestamp(),
      lastPaymentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { balancePoints: nextBalance, stale: false };
  });
  if (claim.wasSuspended) {
    try {
      await resolvePayment({ db, clientId: claim.clientId, eventId: `usage-payment-resolved-${paymentIntent.id}`, invoiceId: paymentIntent.id });
    } catch (error) {
      await accountRef.set({ billingResolutionPending: true, billingResolutionLastError: text(error?.message).slice(0, 200), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      console.error("Usage payment succeeded but account restoration needs a retry", error);
    }
  }
  return result;
}

export async function settleUsageThreshold({ db, stripe = null, clientId }) {
  await reconcileNonAcceptedLeadUsage({ db, clientId: text(clientId), force: true });
  const client = stripeClient(stripe);
  if (!client) return { status: "pending", reason: "stripe_not_configured" };
  const usagePrice = await ensureStripeUsagePrice({ stripe: client });
  let lastResult = { status: "not_due" };
  for (let index = 0; index < 5; index += 1) {
    const claim = await claimCharge(db, text(clientId));
    if (!claim) return lastResult;
    if (!claim.customerId || !claim.paymentMethodId) {
      const error = new Error("PAYMENT_METHOD_MISSING");
      await markDeclined(db, claim, "", error);
      return { status: "declined" };
    }
    try {
      const paymentIntent = await client.paymentIntents.create({
        amount: claim.amountCents,
        currency: usagePrice.currency,
        customer: claim.customerId,
        payment_method: claim.paymentMethodId,
        confirm: true,
        off_session: true,
        description: "ARK usage threshold",
        metadata: {
          uid: claim.uid,
          clientId: claim.clientId,
          usageChargeSequence: String(claim.sequence),
          usagePriceId: usagePrice.usagePriceId,
          usageProductId: usagePrice.usageProductId,
          usageChargeFullAmountCents: String(usagePrice.unitAmount),
          referralDiscountPercent: String(claim.referralDiscountPercent),
          chargedAmountCents: String(claim.amountCents),
        },
      }, { idempotencyKey: `ark-usage-threshold-${claim.uid}-${claim.sequence}` });
      if (paymentIntent.status !== "succeeded") {
        const error = new Error(`PAYMENT_${text(paymentIntent.status).toUpperCase()}`);
        error.payment_intent = paymentIntent;
        await markDeclined(db, claim, paymentIntent.id, error);
        return { status: "declined", paymentIntentId: paymentIntent.id };
      }
      const paid = await markPaid(db, claim, paymentIntent);
      if (!paid.stale) {
        await sendAdminEvent({
          id: `billing-paid-${paymentIntent.id}`,
          type: "billing.payment_succeeded",
          clientId: claim.clientId,
          businessName: claim.businessName,
          summary: "Usage payment succeeded",
          metadata: {
            paymentId: paymentIntent.id,
            paymentKind: "usage",
            amountCents: claim.amountCents,
            currency: text(paymentIntent.currency || usagePrice.currency || "usd").toLowerCase(),
            referralDiscountPercent: claim.referralDiscountPercent,
          },
        });
      }
      lastResult = {
        status: "paid",
        paymentIntentId: paymentIntent.id,
        balancePoints: paid.balancePoints,
        amountCents: claim.amountCents,
        referralDiscountPercent: claim.referralDiscountPercent,
      };
      if (paid.balancePoints < USAGE_CHARGE_THRESHOLD_POINTS) return lastResult;
    } catch (error) {
      const paymentIntentId = text(error?.payment_intent?.id || error?.raw?.payment_intent?.id);
      if (paymentDeclined(error)) {
        await markDeclined(db, claim, paymentIntentId, error);
        return { status: "declined", paymentIntentId };
      }
      await markTransientFailure(db, claim, error);
      throw error;
    }
  }
  return lastResult;
}

export async function retryUsageThresholdCharges({ db, stripe = null, maximum = 100 } = {}) {
  const snapshot = await db.collection("accounts").where("usageBalancePoints", ">=", USAGE_CHARGE_THRESHOLD_POINTS).limit(Math.max(1, maximum)).get();
  const results = [];
  for (const document of snapshot.docs) {
    if (!isStandardRole(document.data().role)) continue;
    try {
      results.push({ clientId: document.id, ...(await settleUsageThreshold({ db, stripe, clientId: document.id })) });
    } catch (error) {
      results.push({ clientId: document.id, status: "error", error: text(error?.message) });
    }
  }
  const restorationSnapshot = await db.collection("accounts").where("billingResolutionPending", "==", true).limit(Math.max(1, maximum)).get();
  for (const document of restorationSnapshot.docs) {
    const account = document.data();
    if (!isStandardRole(account.role)) continue;
    const paymentIntentId = text(account.usageChargeLastPaymentIntentId);
    try {
      await resolvePayment({ db, clientId: text(account.clientId), eventId: `usage-payment-resolved-${paymentIntentId}`, invoiceId: paymentIntentId });
      await document.ref.set({ billingResolutionPending: FieldValue.delete(), billingResolutionLastError: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ clientId: document.id, status: "restored" });
    } catch (error) {
      results.push({ clientId: document.id, status: "restoration_error", error: text(error?.message) });
    }
  }
  return results;
}
