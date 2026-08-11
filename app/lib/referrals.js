import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  MAX_MONTHLY_REFERRALS,
  REFERRAL_DISCOUNT_PERCENT,
  referralDiscountPercent,
} from "./billingPricing.js";
import { normalizeClientId } from "./valueUtils.js";
import { missingStripeResource, resolveBillingWindow } from "./stripeUsageBilling.js";

function text(value) { return String(value || "").trim(); }
function stableId(...values) {
  return createHash("sha256").update(values.map(text).join(":"))
    .digest("hex").slice(0, 48);
}

export function referralPeriodDocumentId(clientId, billingPeriodKey) {
  return stableId("referral-period", clientId, billingPeriodKey);
}

export function referralDocumentId(referrerClientId, referredClientId) {
  return stableId("referral", referrerClientId, referredClientId);
}

export async function validateReferrerAccount({ db, referrerAccountId, referredClientId }) {
  const referrerClientId = normalizeClientId(referrerAccountId);
  if (!text(referrerAccountId)) return { referrerClientId: "", referrerBusinessName: "" };
  if (!referrerClientId) throw new Error("REFERRER_NOT_FOUND");
  if (referrerClientId === normalizeClientId(referredClientId)) throw new Error("SELF_REFERRAL");
  const snapshot = await db.collection("businesses").doc(referrerClientId).get();
  if (!snapshot.exists || snapshot.data().status !== "active") throw new Error("REFERRER_NOT_FOUND");
  return {
    referrerClientId,
    referrerBusinessName: text(snapshot.data().businessName || referrerClientId),
  };
}

export function pendingReferralFields(referrer) {
  if (!referrer?.referrerClientId) return {
    referrerClientId: null,
    referralStatus: "none",
  };
  return {
    referrerClientId: referrer.referrerClientId,
    referrerBusinessName: referrer.referrerBusinessName || null,
    referralStatus: "pending_activation",
    referralCreatedAt: FieldValue.serverTimestamp(),
  };
}

export async function referralCountForPeriod({ db, clientId, billingPeriodKey }) {
  if (!clientId || !billingPeriodKey) return 0;
  const snapshot = await db.collection("referralPeriods")
    .doc(referralPeriodDocumentId(clientId, billingPeriodKey)).get();
  return snapshot.exists
    ? Math.min(MAX_MONTHLY_REFERRALS, Math.max(0, Number(snapshot.data().qualifiedCount || 0)))
    : 0;
}

function couponId(clientId, billingPeriodKey, percent) {
  return `arkref_${stableId(clientId, billingPeriodKey).slice(0, 24)}_${percent}`;
}

async function ensureReferralCoupon({ stripe, clientId, billingPeriodKey, percent }) {
  const id = couponId(clientId, billingPeriodKey, percent);
  try {
    return await stripe.coupons.retrieve(id);
  } catch (error) {
    if (!missingStripeResource(error)) throw error;
  }
  return stripe.coupons.create({
    id,
    percent_off: percent,
    duration: "once",
    name: `ARK referral savings (${percent}% off)`,
    metadata: {
      ark_referrer_client_id: clientId,
      ark_billing_period: billingPeriodKey,
      ark_referral_discount_percent: String(percent),
    },
  });
}

export async function applyReferralPeriodDiscount({ db, stripe, periodId }) {
  const periodRef = db.collection("referralPeriods").doc(periodId);
  const snapshot = await periodRef.get();
  if (!snapshot.exists) return { status: "missing" };
  const period = snapshot.data();
  const count = Math.min(MAX_MONTHLY_REFERRALS, Math.max(0, Number(period.qualifiedCount || 0)));
  const percent = referralDiscountPercent(count);
  const subscriptionId = text(period.stripeSubscriptionId);
  if (!count || !subscriptionId) return { status: "not-applicable", count, percent };
  try {
    const coupon = await ensureReferralCoupon({
      stripe,
      clientId: text(period.referrerClientId),
      billingPeriodKey: text(period.billingPeriodKey),
      percent,
    });
    await stripe.subscriptions.update(subscriptionId, { discounts: [{ coupon: coupon.id }] });
    await periodRef.set({
      discountPercent: percent,
      stripeCouponId: coupon.id,
      stripeStatus: "applied",
      stripeAppliedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const referredClientIds = Array.isArray(period.referredClientIds) ? period.referredClientIds.map(text).filter(Boolean) : [];
    for (const referredClientId of referredClientIds) {
      const businessRef = db.collection("businesses").doc(referredClientId);
      const businessSnapshot = await businessRef.get();
      const uid = businessSnapshot.exists ? text(businessSnapshot.data().uid || businessSnapshot.data().ownerUid) : "";
      const update = { referralStatus: "qualified", referralUpdatedAt: FieldValue.serverTimestamp() };
      await Promise.all([
        businessRef.set(update, { merge: true }),
        uid ? db.collection("accounts").doc(uid).set(update, { merge: true }) : Promise.resolve(),
      ]);
    }
    return { status: "applied", count, percent, couponId: coupon.id };
  } catch (error) {
    await periodRef.set({
      discountPercent: percent,
      stripeStatus: "pending",
      stripeLastError: text(error?.message).slice(0, 300),
      stripeLastAttemptAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

async function markReferredAccount(db, referredClientId, referredUid, update) {
  await Promise.all([
    db.collection("businesses").doc(referredClientId).set(update, { merge: true }),
    referredUid ? db.collection("accounts").doc(referredUid).set(update, { merge: true }) : Promise.resolve(),
  ]);
}

export async function qualifyReferralAfterActivation({ db, stripe, referredClientId, referredUid }) {
  const referredBusinessRef = db.collection("businesses").doc(referredClientId);
  const referredAccountRef = referredUid ? db.collection("accounts").doc(referredUid) : null;
  const [businessSnapshot, accountSnapshot] = await Promise.all([
    referredBusinessRef.get(),
    referredAccountRef ? referredAccountRef.get() : Promise.resolve(null),
  ]);
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  const account = accountSnapshot?.exists ? accountSnapshot.data() : {};
  const referrerClientId = normalizeClientId(business.referrerClientId || account.referrerClientId);
  if (!referrerClientId) return { status: "none" };
  const referredStatus = text(account.status || business.status);
  const paymentSetupStatus = text(account.paymentSetupStatus || business.paymentSetupStatus);
  const subscriptionIdForReferredAccount = text(account.stripeSubscriptionId || business.stripeSubscriptionId);
  const subscriptionStatusForReferredAccount = text(account.stripeSubscriptionStatus || business.stripeSubscriptionStatus);
  if (referredStatus !== "active" || paymentSetupStatus !== "complete" || !subscriptionIdForReferredAccount || subscriptionStatusForReferredAccount !== "active") {
    await markReferredAccount(db, referredClientId, referredUid, {
      referralStatus: "pending_payment",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "pending_payment" };
  }

  const [referrerSnapshot, referrerReceptionistSnapshot] = await Promise.all([
    db.collection("businesses").doc(referrerClientId).get(),
    db.collection("ocmClients").doc(referrerClientId).collection("settings").doc("receptionist").get(),
  ]);
  if (!referrerSnapshot.exists || referrerSnapshot.data().status !== "active") {
    await markReferredAccount(db, referredClientId, referredUid, {
      referralStatus: "invalid_referrer",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "invalid_referrer" };
  }
  const referrer = referrerSnapshot.data();
  const subscriptionId = text(referrer.stripeSubscriptionId);
  let window;
  try {
    window = await resolveBillingWindow({
      stripe,
      subscriptionId,
      timeZone: text(referrerReceptionistSnapshot.exists ? referrerReceptionistSnapshot.data().timeZone : "")
        || text(referrer.timeZone)
        || "America/New_York",
      strictSubscription: true,
    });
  } catch (error) {
    await markReferredAccount(db, referredClientId, referredUid, {
      referralStatus: "pending_activation",
      referralLastError: "Could not determine the referrer's Stripe billing period yet.",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "pending_activation", error };
  }

  const periodId = referralPeriodDocumentId(referrerClientId, window.monthKey);
  const periodRef = db.collection("referralPeriods").doc(periodId);
  const referralRef = db.collection("referrals")
    .doc(referralDocumentId(referrerClientId, referredClientId));
  const result = await db.runTransaction(async (transaction) => {
    const [periodSnapshot, referralSnapshot] = await Promise.all([
      transaction.get(periodRef),
      transaction.get(referralRef),
    ]);
    const period = periodSnapshot.exists ? periodSnapshot.data() : {};
    const existingReferral = referralSnapshot.exists ? referralSnapshot.data() : {};
    if (existingReferral.qualified === true) {
      return { status: "qualified", count: Number(period.qualifiedCount || 0), existing: true };
    }
    const currentCount = Math.max(0, Number(period.qualifiedCount || 0));
    if (currentCount >= MAX_MONTHLY_REFERRALS) {
      const cappedUpdate = {
        referrerClientId,
        referredClientId,
        referredUid: referredUid || null,
        billingPeriodKey: window.monthKey,
        qualified: false,
        status: "limit_reached",
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.set(referralRef, cappedUpdate, { merge: true });
      transaction.set(referredBusinessRef, { referralStatus: "limit_reached", referralBillingPeriodKey: window.monthKey, referralUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (referredAccountRef) transaction.set(referredAccountRef, { referralStatus: "limit_reached", referralBillingPeriodKey: window.monthKey, referralUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { status: "limit_reached", count: currentCount };
    }
    const qualifiedCount = currentCount + 1;
    transaction.set(periodRef, {
      referrerClientId,
      billingPeriodKey: window.monthKey,
      periodStart: new Date(window.startMs),
      periodEnd: new Date(window.endMs),
      stripeSubscriptionId: subscriptionId,
      qualifiedCount,
      referredClientIds: FieldValue.arrayUnion(referredClientId),
      discountPercent: referralDiscountPercent(qualifiedCount),
      stripeStatus: "pending",
      createdAt: period.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(referralRef, {
      referrerClientId,
      referredClientId,
      referredUid: referredUid || null,
      billingPeriodKey: window.monthKey,
      qualified: true,
      status: "qualified",
      qualifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const referredUpdate = {
      referralStatus: "qualified",
      referralBillingPeriodKey: window.monthKey,
      referralQualifiedAt: FieldValue.serverTimestamp(),
      referralUpdatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(referredBusinessRef, referredUpdate, { merge: true });
    if (referredAccountRef) transaction.set(referredAccountRef, referredUpdate, { merge: true });
    transaction.set(db.collection("businesses").doc(referrerClientId), {
      currentReferralPeriodKey: window.monthKey,
      currentReferralCount: qualifiedCount,
      currentReferralDiscountPercent: referralDiscountPercent(qualifiedCount),
      referralUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: "qualified", count: qualifiedCount, existing: false };
  });

  if (result.status !== "qualified") return { ...result, periodKey: window.monthKey };
  try {
    const stripeResult = await applyReferralPeriodDiscount({ db, stripe, periodId });
    await markReferredAccount(db, referredClientId, referredUid, {
      referralStatus: "qualified",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { ...result, periodKey: window.monthKey, stripeStatus: stripeResult.status };
  } catch (error) {
    await markReferredAccount(db, referredClientId, referredUid, {
      referralStatus: "pending_discount",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { ...result, periodKey: window.monthKey, stripeStatus: "pending", error };
  }
}

export async function retryPendingReferralDiscounts({ db, stripe }) {
  const snapshot = await db.collection("referralPeriods").get();
  const pending = snapshot.docs.filter((document) => document.data().stripeStatus === "pending");
  const results = [];
  for (const document of pending) {
    try {
      results.push({ periodId: document.id, ...(await applyReferralPeriodDiscount({ db, stripe, periodId: document.id })) });
    } catch (error) {
      results.push({ periodId: document.id, status: "pending", error: text(error?.message) });
    }
  }
  return results;
}

export async function retryPendingReferralActivations({ db, stripe }) {
  const businesses = await db.collection("businesses").get();
  const pending = businesses.docs.filter((document) => {
    const data = document.data();
    return Boolean(text(data.referrerClientId)) && ["pending_activation", "pending_payment"].includes(text(data.referralStatus));
  });
  const results = [];
  for (const document of pending) {
    const data = document.data();
    const uid = text(data.uid || data.ownerUid);
    if (data.status !== "active") continue;
    results.push({
      clientId: document.id,
      ...(await qualifyReferralAfterActivation({ db, stripe, referredClientId: document.id, referredUid: uid })),
    });
  }
  return results;
}

export async function loadReferralStatus({ db, clientId, billingPeriodKey }) {
  const count = await referralCountForPeriod({ db, clientId, billingPeriodKey });
  return {
    accountId: clientId,
    billingPeriodKey,
    referralCount: count,
    maximumReferrals: MAX_MONTHLY_REFERRALS,
    discountPerReferralPercent: REFERRAL_DISCOUNT_PERCENT,
    referralDiscountPercent: referralDiscountPercent(count),
    referralsRemaining: Math.max(0, MAX_MONTHLY_REFERRALS - count),
  };
}
