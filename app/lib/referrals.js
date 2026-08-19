import { createHash, createHmac } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  MAX_ACTIVE_REFERRALS,
  REFERRAL_DISCOUNT_DURATION_DAYS,
  REFERRAL_DISCOUNT_PERCENT,
  referralDiscountPercent,
} from "./billingPricing.js";
import { systemCollection } from "./firestoreLayout.js";
import { normalizeSignupEmail, normalizeSignupPhone } from "./signupAvailability.js";
import { normalizeClientId } from "./valueUtils.js";

const REFERRAL_DISCOUNT_DURATION_MS = REFERRAL_DISCOUNT_DURATION_DAYS * 24 * 60 * 60 * 1000;

function text(value) { return String(value || "").trim(); }
function stableId(...values) {
  return createHash("sha256").update(values.map(text).join(":"))
    .digest("hex").slice(0, 48);
}
function referralIdentitySecret() {
  const secret = text(process.env.REFERRAL_IDENTITY_SECRET || process.env.ACCOUNT_VERIFICATION_SECRET || process.env.SESSION_COOKIE_SECRET || process.env.STRIPE_SECRET_KEY);
  if (!secret) throw new Error("REFERRAL_IDENTITY_SECRET is required to protect referral identity claims.");
  return secret;
}
function normalizedReferralIdentity(type, value) {
  if (text(type) === "email") return normalizeSignupEmail(value);
  if (text(type) === "phone") return normalizeSignupPhone(value);
  return text(value);
}
function referralIdentityHash(type, value) {
  return createHmac("sha256", referralIdentitySecret())
    .update(`ark-referral-identity-v1:${text(type)}:${normalizedReferralIdentity(type, value)}`)
    .digest("hex");
}
export function referralIdentityClaimDocumentId(type, value) {
  return `${text(type)}-${referralIdentityHash(type, value)}`;
}
function referralIdentityClaims(db, business = {}) {
  const email = normalizeSignupEmail(business.accountEmail || business.businessEmail);
  const phone = normalizeSignupPhone(business.accountPhone || business.businessPhone);
  if (!/^\S+@\S+\.\S+$/.test(email) || !/^\+1\d{10}$/.test(phone)) throw new Error("REFERRAL_VERIFIED_IDENTITY_REQUIRED");
  const collection = systemCollection(db, "referralIdentityClaims");
  return [
    { type: "email", hash: referralIdentityHash("email", email), ref: collection.doc(referralIdentityClaimDocumentId("email", email)) },
    { type: "phone", hash: referralIdentityHash("phone", phone), ref: collection.doc(referralIdentityClaimDocumentId("phone", phone)) },
  ];
}
function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function referralDocumentId(referrerClientId, referredClientId) {
  return stableId("referral", referrerClientId, referredClientId);
}

export function referralDiscountEndsAt(qualifiedAt) {
  const qualifiedAtMs = millis(qualifiedAt);
  return qualifiedAtMs ? qualifiedAtMs + REFERRAL_DISCOUNT_DURATION_MS : 0;
}

export async function validateReferrerAccount({ db, referrerAccountId, referredClientId }) {
  const referrerClientId = normalizeClientId(referrerAccountId);
  if (!text(referrerAccountId)) return { referrerClientId: "", referrerBusinessName: "" };
  if (!referrerClientId) throw new Error("REFERRER_NOT_FOUND");
  if (referrerClientId === normalizeClientId(referredClientId)) throw new Error("SELF_REFERRAL");
  const snapshot = await db.collection("accounts").doc(referrerClientId).get();
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

export async function activeReferralSavings({ db, clientId, now = Date.now() }) {
  const safeClientId = normalizeClientId(clientId);
  if (!safeClientId) return { count: 0, totalActiveCount: 0, percent: 0, nextExpirationAt: 0 };
  const snapshot = await systemCollection(db, "referrals")
    .where("referrerClientId", "==", safeClientId)
    .get();
  const currentMs = millis(now) || Date.now();
  const active = snapshot.docs
    .map((document) => {
      const data = document.data();
      const qualifiedAt = millis(data.qualifiedAt);
      const endsAt = millis(data.discountEndsAt) || referralDiscountEndsAt(qualifiedAt);
      return { qualified: data.qualified === true, referrerDeleted: data.referrerDeleted === true, endsAt };
    })
    .filter((entry) => entry.qualified && entry.referrerDeleted !== true && entry.endsAt > currentMs)
    .sort((left, right) => left.endsAt - right.endsAt);
  const count = Math.min(MAX_ACTIVE_REFERRALS, active.length);
  return {
    count,
    totalActiveCount: active.length,
    percent: referralDiscountPercent(count),
    nextExpirationAt: active[0]?.endsAt || 0,
  };
}

async function markReferredAccount(db, referredClientId, update) {
  await db.collection("accounts").doc(referredClientId).set(update, { merge: true });
}

export async function qualifyReferralAfterActivation({ db, referredClientId, referredUid, now = Date.now() }) {
  const referredBusinessRef = db.collection("accounts").doc(referredClientId);
  const businessSnapshot = await referredBusinessRef.get();
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  const referrerClientId = normalizeClientId(business.referrerClientId);
  if (!referrerClientId) return { status: "none" };
  const paidAccountIsActive = text(business.status) === "active"
    && text(business.paymentSetupStatus) === "complete"
    && Boolean(text(business.stripeSubscriptionId))
    && text(business.stripeSubscriptionStatus) === "active"
    && business.identityVerificationVerified === true;
  if (!paidAccountIsActive) {
    await markReferredAccount(db, referredClientId, {
      referralStatus: "pending_payment",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "pending_payment" };
  }

  const referrerSnapshot = await db.collection("accounts").doc(referrerClientId).get();
  if (!referrerSnapshot.exists || referrerSnapshot.data().status !== "active") {
    await markReferredAccount(db, referredClientId, {
      referralStatus: "invalid_referrer",
      referralUpdatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "invalid_referrer" };
  }

  const qualifiedAtMs = millis(business.activatedAt) || millis(now) || Date.now();
  const discountEndsAtMs = qualifiedAtMs + REFERRAL_DISCOUNT_DURATION_MS;
  const referralRef = systemCollection(db, "referrals")
    .doc(referralDocumentId(referrerClientId, referredClientId));
  const identityClaims = referralIdentityClaims(db, business);
  const result = await db.runTransaction(async (transaction) => {
    const [referralSnapshot, ...identitySnapshots] = await Promise.all([
      transaction.get(referralRef),
      ...identityClaims.map((claim) => transaction.get(claim.ref)),
    ]);
    const existingReferral = referralSnapshot.exists ? referralSnapshot.data() : {};
    const referralId = referralRef.id;
    const claimedByAnotherReferral = identitySnapshots.some((snapshot) => snapshot.exists
      && (text(snapshot.data().referralId) !== referralId || text(snapshot.data().referredClientId) !== referredClientId));
    if (claimedByAnotherReferral) {
      transaction.set(referralRef, {
        qualified: false,
        status: "identity_already_used",
        rejectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(referredBusinessRef, {
        referralStatus: "identity_already_used",
        referralRejectedAt: FieldValue.serverTimestamp(),
        referralUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { status: "identity_already_used", existing: false };
    }
    if (existingReferral.qualified === true) {
      identityClaims.forEach((claim, index) => {
        if (identitySnapshots[index].exists) return;
        transaction.create(claim.ref, {
          identityType: claim.type,
          identityHash: claim.hash,
          referralId,
          referrerClientId,
          referredClientId,
          qualifiedAt: existingReferral.qualifiedAt || Timestamp.fromMillis(qualifiedAtMs),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return { status: "qualified", existing: true };
    }
    transaction.set(referralRef, {
      referrerClientId,
      referredClientId,
      referredUid: referredUid || null,
      qualified: true,
      status: "qualified",
      qualifiedAt: Timestamp.fromMillis(qualifiedAtMs),
      discountEndsAt: Timestamp.fromMillis(discountEndsAtMs),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existingReferral.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });
    identityClaims.forEach((claim, index) => {
      const claimData = {
        identityType: claim.type,
        identityHash: claim.hash,
        referralId,
        referrerClientId,
        referredClientId,
        qualifiedAt: Timestamp.fromMillis(qualifiedAtMs),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: identitySnapshots[index].exists ? (identitySnapshots[index].data().createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      };
      transaction.set(claim.ref, claimData, { merge: true });
    });
    transaction.set(referredBusinessRef, {
      referralStatus: "qualified",
      referralQualifiedAt: Timestamp.fromMillis(qualifiedAtMs),
      referralDiscountEndsAt: Timestamp.fromMillis(discountEndsAtMs),
      referralUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: "qualified", existing: false };
  });

  if (result.status !== "qualified") return result;
  const savings = await activeReferralSavings({ db, clientId: referrerClientId, now: qualifiedAtMs });
  await db.collection("accounts").doc(referrerClientId).set({
    currentReferralCount: savings.count,
    currentReferralDiscountPercent: savings.percent,
    currentReferralDiscountEndsAt: savings.nextExpirationAt ? Timestamp.fromMillis(savings.nextExpirationAt) : FieldValue.delete(),
    currentReferralPeriodKey: FieldValue.delete(),
    referralUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return {
    ...result,
    count: savings.count,
    discountPercent: savings.percent,
    discountEndsAt: discountEndsAtMs,
  };
}

export async function retryPendingReferralActivations({ db }) {
  const businesses = await db.collection("accounts").get();
  const pending = businesses.docs.filter((document) => {
    const data = document.data();
    return Boolean(text(data.referrerClientId)) && ["pending_activation", "pending_payment"].includes(text(data.referralStatus));
  });
  const results = [];
  for (const document of pending) {
    const data = document.data();
    if (data.status !== "active") continue;
    results.push({
      clientId: document.id,
      ...(await qualifyReferralAfterActivation({ db, referredClientId: document.id, referredUid: text(data.uid) })),
    });
  }
  return results;
}

export async function retireLegacyReferralSubscriptionDiscounts({ db, stripe }) {
  const snapshot = await systemCollection(db, "referralPeriods").get();
  const results = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    const status = text(data.stripeStatus);
    if (["retired", "removed"].includes(status)) continue;
    const subscriptionId = text(data.stripeSubscriptionId);
    const couponWasApplied = ["applied", "removal_pending"].includes(status) && Boolean(text(data.stripeCouponId));
    try {
      if (couponWasApplied && subscriptionId) {
        await stripe.subscriptions.update(subscriptionId, { discounts: "", proration_behavior: "none" });
      }
      await document.ref.set({
        stripeStatus: couponWasApplied ? "removed" : "retired",
        stripeRemovedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      results.push({ periodId: document.id, status: couponWasApplied ? "removed" : "retired" });
    } catch (error) {
      await document.ref.set({
        stripeStatus: "removal_pending",
        stripeLastError: text(error?.message).slice(0, 300),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      results.push({ periodId: document.id, status: "removal_pending", error: text(error?.message) });
    }
  }
  return results;
}

export async function loadReferralStatus({ db, clientId, now = Date.now() }) {
  const savings = await activeReferralSavings({ db, clientId, now });
  return {
    accountId: clientId,
    referralCount: savings.count,
    activeReferralCount: savings.count,
    maximumReferrals: MAX_ACTIVE_REFERRALS,
    discountPerReferralPercent: REFERRAL_DISCOUNT_PERCENT,
    referralDiscountPercent: savings.percent,
    referralsRemaining: Math.max(0, MAX_ACTIVE_REFERRALS - savings.count),
    discountDurationDays: REFERRAL_DISCOUNT_DURATION_DAYS,
    nextExpirationAt: savings.nextExpirationAt ? new Date(savings.nextExpirationAt).toISOString() : "",
  };
}
