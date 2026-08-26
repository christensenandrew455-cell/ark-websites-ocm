import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { sendAdminEvent } from "./adminEvents.js";
import { APPLE_IAP_BASE_PRODUCT_ID, appleUsageProduct } from "./appleIapCatalog.js";
import { sameAppleAccountToken } from "./appleIapRequest.js";
import { resolvePayment } from "./billingDelinquency.js";
import { systemCollection } from "./firestoreLayout.js";
import { activeReferralSavings } from "./referrals.js";
import { USAGE_CHARGE_THRESHOLD_POINTS, USAGE_POINT_CENTS } from "./billingPricing.js";

function text(value) { return String(value || "").trim(); }
function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export async function syncAppleSubscriptionTransaction({ db, clientId, transaction, eventId = "" }) {
  const transactionId = text(transaction?.transactionId);
  const originalTransactionId = text(transaction?.originalTransactionId);
  const expiresAt = Number(transaction?.expiresDate || 0);
  if (!clientId || !transactionId || !originalTransactionId
    || text(transaction.productId) !== APPLE_IAP_BASE_PRODUCT_ID
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
  const transactionRef = systemCollection(db, "appleTransactions").doc(transactionId);
  const transactionSnapshot = await transactionRef.get();
  const patch = {
    appleSubscriptionProductId: APPLE_IAP_BASE_PRODUCT_ID,
    appleOriginalTransactionId: originalTransactionId,
    appleSubscriptionTransactionId: transactionId,
    appleSubscriptionStatus: active ? "active" : transaction.revocationDate ? "revoked" : "expired",
    appleSubscriptionEnvironment: text(transaction.environment),
    appleSubscriptionExpiresAt: expiresAt ? Timestamp.fromMillis(expiresAt) : FieldValue.delete(),
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
      productId: APPLE_IAP_BASE_PRODUCT_ID,
      originalTransactionId,
      appAccountToken: text(transaction.appAccountToken).toLowerCase(),
      environment: text(transaction.environment),
      purchaseDate: Number(transaction.purchaseDate || 0) ? Timestamp.fromMillis(Number(transaction.purchaseDate)) : FieldValue.serverTimestamp(),
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
    await sendAdminEvent({
      id: `billing-paid-apple-${transactionId}`,
      type: "billing.payment_succeeded",
      clientId,
      businessName: text(account.businessName || clientId),
      summary: "Apple monthly payment succeeded",
      metadata: {
        paymentId: transactionId,
        paymentKind: "subscription",
        provider: "apple",
        amountCents: Number(transaction.price || 0) > 0 ? Math.round(Number(transaction.price) / 10) : 0,
        currency: text(transaction.currency).toLowerCase(),
      },
    });
  }
  return { active, expiresAt, transactionId, duplicate: transactionSnapshot.exists };
}

export async function settleAppleUsagePurchase({ db, clientId, uid, transaction }) {
  const transactionId = text(transaction?.transactionId);
  if (!transactionId || text(transaction.type) !== "Consumable" || transaction.revocationDate) throw new Error("APPLE_USAGE_PURCHASE_INVALID");
  const accountRef = db.collection("accounts").doc(clientId);
  const quotedAccountSnapshot = await accountRef.get();
  if (!quotedAccountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
  const referral = await activeReferralSavings({ db, clientId });
  const calculated = appleUsageProduct(referral.percent);
  const quotedAccount = quotedAccountSnapshot.data();
  const expected = {
    productId: text(quotedAccount.usageChargeAppleProductId || calculated.productId),
    discountPercent: whole(quotedAccount.usageChargeReferralDiscountPercent || calculated.discountPercent),
    amountCents: whole(quotedAccount.usageChargeAmountCents || calculated.amountCents),
  };
  if (text(transaction.productId) !== expected.productId) throw new Error("APPLE_USAGE_PRODUCT_CHANGED");

  const transactionRef = systemCollection(db, "appleTransactions").doc(transactionId);
  const result = await db.runTransaction(async (firestoreTransaction) => {
    const [accountSnapshot, transactionSnapshot] = await Promise.all([
      firestoreTransaction.get(accountRef),
      firestoreTransaction.get(transactionRef),
    ]);
    if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    const account = accountSnapshot.data();
    if (account.billingProvider !== "apple"
      || text(account.uid) !== text(uid)
      || !sameAppleAccountToken(account.appleAppAccountToken, transaction.appAccountToken)) {
      throw new Error("APPLE_USAGE_PURCHASE_FORBIDDEN");
    }
    if (text(account.usageChargeAppleProductId || calculated.productId) !== expected.productId) {
      throw new Error("APPLE_USAGE_PRODUCT_CHANGED");
    }
    if (transactionSnapshot.exists) {
      if (text(transactionSnapshot.data().clientId) !== clientId) throw new Error("APPLE_TRANSACTION_ALREADY_USED");
      return {
        duplicate: true,
        balancePoints: whole(account.usageBalancePoints),
        creditPoints: whole(account.appleUsageCreditPoints),
      };
    }

    const currentBalance = whole(account.usageBalancePoints);
    const currentCredit = whole(account.appleUsageCreditPoints);
    const nextBalance = Math.max(0, currentBalance - USAGE_CHARGE_THRESHOLD_POINTS);
    const nextCredit = currentCredit + Math.max(0, USAGE_CHARGE_THRESHOLD_POINTS - currentBalance);
    firestoreTransaction.create(transactionRef, {
      provider: "apple",
      kind: "usage",
      clientId,
      uid: text(uid),
      productId: expected.productId,
      appAccountToken: text(transaction.appAccountToken).toLowerCase(),
      originalTransactionId: text(transaction.originalTransactionId),
      environment: text(transaction.environment),
      points: USAGE_CHARGE_THRESHOLD_POINTS,
      amountCents: expected.amountCents,
      referralDiscountPercent: expected.discountPercent,
      purchaseDate: Number(transaction.purchaseDate || 0) ? Timestamp.fromMillis(Number(transaction.purchaseDate)) : FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    firestoreTransaction.set(accountRef, {
      usageBalancePoints: nextBalance,
      appleUsageCreditPoints: nextCredit,
      usageChargeStatus: nextBalance >= USAGE_CHARGE_THRESHOLD_POINTS ? "purchase_required" : "idle",
      usageChargeAppleProductId: nextBalance >= USAGE_CHARGE_THRESHOLD_POINTS ? calculated.productId : FieldValue.delete(),
      usageChargeAmountCents: nextBalance >= USAGE_CHARGE_THRESHOLD_POINTS ? calculated.amountCents : FieldValue.delete(),
      usageChargeReferralDiscountPercent: nextBalance >= USAGE_CHARGE_THRESHOLD_POINTS ? calculated.discountPercent : FieldValue.delete(),
      lastUsageChargeAmountCents: expected.amountCents,
      lastUsageReferralDiscountPercent: expected.discountPercent,
      lastUsageAppleTransactionId: transactionId,
      lastUsagePaymentAt: FieldValue.serverTimestamp(),
      lastPaymentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { duplicate: false, balancePoints: nextBalance, creditPoints: nextCredit };
  });

  if (!result.duplicate) {
    const accountSnapshot = await accountRef.get();
    await sendAdminEvent({
      id: `billing-paid-apple-${transactionId}`,
      type: "billing.payment_succeeded",
      clientId,
      businessName: text(accountSnapshot.data()?.businessName || clientId),
      summary: "Apple usage purchase succeeded",
      metadata: {
        paymentId: transactionId,
        paymentKind: "usage",
        provider: "apple",
        amountCents: expected.amountCents,
        currency: text(transaction.currency || "usd").toLowerCase(),
        referralDiscountPercent: expected.discountPercent,
      },
    });
  }
  return { ...result, amountCents: expected.amountCents, referralDiscountPercent: expected.discountPercent };
}

export function appleUsageNominalCents() {
  return USAGE_CHARGE_THRESHOLD_POINTS * USAGE_POINT_CENTS;
}
