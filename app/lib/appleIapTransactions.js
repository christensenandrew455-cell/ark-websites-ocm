import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { applePlanForProduct } from "./appleIapCatalog.js";
import { sameAppleAccountToken } from "./appleIapRequest.js";
import { normalizeBillingPlanKey } from "./billingPricing.js";
import { resolvePayment } from "./billingDelinquency.js";
import { systemCollection } from "./firestoreLayout.js";
import { reportRevenuePayment } from "./revenueLedger.js";

function text(value) {
  return String(value || "").trim();
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function syncAppleSubscriptionTransaction({ db, clientId, transaction, eventId = "" }) {
  const transactionId = text(transaction?.transactionId);
  const originalTransactionId = text(transaction?.originalTransactionId);
  const expiresAt = Number(transaction?.expiresDate || 0);
  const purchasedAt = Number(transaction?.purchaseDate || 0) || Date.now();
  const plan = applePlanForProduct(transaction?.productId);
  const amountCents = Number(transaction?.price || 0) > 0 ? Math.round(Number(transaction.price) / 10) : plan?.amountCents;
  const currency = text(transaction?.currency || "usd").toLowerCase();
  if (!clientId || !transactionId || !originalTransactionId
    || !plan
    || text(transaction.type) !== "Auto-Renewable Subscription") throw new Error("APPLE_SUBSCRIPTION_INVALID");

  const accountRef = db.collection("accounts").doc(clientId);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
  const account = accountSnapshot.data();
  if (account.billingProvider !== "apple"
    || !sameAppleAccountToken(account.appleAppAccountToken, transaction.appAccountToken)
    || (text(account.appleOriginalTransactionId) && text(account.appleOriginalTransactionId) !== originalTransactionId)) {
    throw new Error("APPLE_SUBSCRIPTION_FORBIDDEN");
  }

  const active = !transaction.revocationDate && expiresAt > Date.now();
  const samePeriodEnd = expiresAt > 0 && millis(account.acceptedLeadPeriodEndAt || account.callPeriodEndAt) === expiresAt;
  const planChanged = text(account.billingPlanKey) && normalizeBillingPlanKey(account.billingPlanKey) !== plan.key;
  const periodStartAt = samePeriodEnd && !planChanged && millis(account.acceptedLeadPeriodStartAt || account.callPeriodStartAt)
    ? millis(account.acceptedLeadPeriodStartAt || account.callPeriodStartAt)
    : purchasedAt;
  const periodKey = `${periodStartAt}-${expiresAt}`;
  const acceptedLeadsUsed = text(account.acceptedLeadPeriodKey) === periodKey
    ? Math.max(0, Number(account.acceptedLeadsUsedThisPeriod || 0))
    : 0;
  const acceptedLeadTopUps = text(account.acceptedLeadTopUpPeriodKey) === periodKey
    ? Math.max(0, Number(account.acceptedLeadTopUpsThisPeriod || 0))
    : 0;
  const acceptedLeadPeriodLimit = plan.monthlyAcceptedLeads + acceptedLeadTopUps;
  const callsUsed = text(account.callPeriodKey) === periodKey
    ? Math.max(0, Number(account.callsUsedThisPeriod || 0))
    : 0;
  const transactionRef = systemCollection(db, "appleTransactions").doc(transactionId);
  const transactionSnapshot = await transactionRef.get();
  const patch = {
    appleSubscriptionProductId: plan.productId,
    appleOriginalTransactionId: originalTransactionId,
    appleSubscriptionTransactionId: transactionId,
    appleSubscriptionStatus: active ? "active" : transaction.revocationDate ? "revoked" : "expired",
    appleSubscriptionEnvironment: text(transaction.environment),
    appleSubscriptionExpiresAt: expiresAt ? Timestamp.fromMillis(expiresAt) : FieldValue.delete(),
    billingPlanKey: plan.key,
    billingPlanName: plan.name,
    monthlyPlanAmountCents: plan.amountCents,
    monthlyAcceptedLeadLimit: plan.monthlyAcceptedLeads,
    acceptedLeadPeriodLimit,
    acceptedLeadPeriodStartAt: Timestamp.fromMillis(periodStartAt),
    acceptedLeadPeriodEndAt: expiresAt ? Timestamp.fromMillis(expiresAt) : FieldValue.delete(),
    acceptedLeadPeriodKey: periodKey,
    acceptedLeadsUsedThisPeriod: acceptedLeadsUsed,
    acceptedLeadsRemainingThisPeriod: Math.max(0, acceptedLeadPeriodLimit - acceptedLeadsUsed),
    acceptedLeadLimitReached: acceptedLeadsUsed >= acceptedLeadPeriodLimit,
    acceptedLeadTopUpPeriodKey: periodKey,
    acceptedLeadTopUpsThisPeriod: acceptedLeadTopUps,
    monthlyCallLimit: plan.monthlyCalls,
    callPeriodStartAt: Timestamp.fromMillis(periodStartAt),
    callPeriodEndAt: expiresAt ? Timestamp.fromMillis(expiresAt) : FieldValue.delete(),
    callPeriodKey: periodKey,
    callsUsedThisPeriod: callsUsed,
    callsRemainingThisPeriod: Math.max(0, plan.monthlyCalls - callsUsed),
    callLimitReached: callsUsed >= plan.monthlyCalls,
    ...(active ? { lastPaymentAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(accountRef, patch, { merge: true });
  if (!transactionSnapshot.exists) {
    batch.create(transactionRef, {
      provider: "apple",
      kind: "subscription",
      clientId,
      uid: text(account.uid),
      businessName: text(account.businessName || clientId),
      productId: plan.productId,
      billingPlanKey: plan.key,
      amountCents,
      currency,
      monthlyAcceptedLeads: plan.monthlyAcceptedLeads,
      monthlyCalls: plan.monthlyCalls,
      originalTransactionId,
      appAccountToken: text(transaction.appAccountToken).toLowerCase(),
      environment: text(transaction.environment),
      purchaseDate: Timestamp.fromMillis(purchasedAt),
      expiresAt: expiresAt ? Timestamp.fromMillis(expiresAt) : null,
      notificationEventId: text(eventId),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  if (active && account.billingPastDue === true) {
    await resolvePayment({
      db,
      clientId,
      eventId: `apple-subscription-resolved-${text(eventId || transactionId)}`,
      invoiceId: transactionId,
      provider: "apple",
    });
  }
  if (!transactionSnapshot.exists) {
    await reportRevenuePayment({
      db,
      eventId: `billing-paid-apple-${transactionId}`,
      provider: "apple",
      paymentId: transactionId,
      paymentKind: "subscription",
      clientId,
      businessName: text(account.businessName || clientId),
      amountCents,
      currency,
      paidAt: purchasedAt,
      summary: `${plan.name} monthly payment succeeded`,
      metadata: {
        billingPlan: plan.key,
        monthlyAcceptedLeads: plan.monthlyAcceptedLeads,
        monthlyCalls: plan.monthlyCalls,
      },
    });
  }
  return {
    active,
    expiresAt,
    transactionId,
    duplicate: transactionSnapshot.exists,
    planKey: plan.key,
    monthlyAcceptedLeads: plan.monthlyAcceptedLeads,
    monthlyCalls: plan.monthlyCalls,
  };
}
