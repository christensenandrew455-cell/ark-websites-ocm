import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { acceptedLeadPlanStatus } from "./acceptedLeadPlanBilling.js";
import { accountRef, systemCollection } from "./firestoreLayout.js";
import { normalizeClientId } from "./valueUtils.js";

export const REFERRAL_REWARD_KIND = "free-subscription-month";
export const REFERRAL_REWARD_PROVIDER = "stripe";

function text(value) {
  return String(value || "").trim();
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function billingProvider(account = {}) {
  return text(account.billingProvider || (account.appleOriginalTransactionId ? "apple" : "stripe")).toLowerCase();
}

function rewardRecordResult(record = {}) {
  return {
    recorded: true,
    rewarded: record.rewarded === true,
    credited: record.rewardStatus === "credited",
    rewardStatus: text(record.rewardStatus),
    rewardAmountCents: whole(record.rewardAmountCents),
    referrerClientId: normalizeClientId(record.referrerClientId),
    referredClientId: normalizeClientId(record.referredClientId),
    stripeCustomerId: text(record.stripeCustomerId),
  };
}

export function referralRewardAmountCents(account = {}) {
  return acceptedLeadPlanStatus(account).monthlyPriceCents;
}

export function publicReferralRewardSummary(account = {}) {
  const provider = billingProvider(account);
  const plan = acceptedLeadPlanStatus(account);
  return {
    billingProvider: provider,
    referralRewardAvailable: provider === REFERRAL_REWARD_PROVIDER,
    referralFreeMonthsEarned: whole(account.referralFreeMonthsEarned),
    referralFreeMonthsPending: whole(account.referralFreeMonthsPending),
    referralFreeMonthsCredited: whole(account.referralFreeMonthsCredited),
    referralPlanName: plan.planName,
    referralPlanAmountCents: plan.monthlyPriceCents,
  };
}

function stripeClient(providedStripe) {
  if (providedStripe) return providedStripe;
  const secretKey = text(process.env.STRIPE_SECRET_KEY);
  return secretKey ? new Stripe(secretKey) : null;
}

async function markCreditAttemptFailed(rewardRef) {
  await rewardRef.set({
    rewardLastAttemptAt: FieldValue.serverTimestamp(),
    rewardAttemptCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => null);
}

async function applyStripeReferralCredit({ db, stripe, rewardRef, reward }) {
  const referrerId = normalizeClientId(reward.referrerClientId);
  const referredId = normalizeClientId(reward.referredClientId || rewardRef.id);
  const customerId = text(reward.stripeCustomerId);
  const amountCents = whole(reward.rewardAmountCents);
  if (!referrerId || !referredId || !customerId || !amountCents) return { ...reward, credited: false };

  const client = stripeClient(stripe);
  if (!client) {
    await markCreditAttemptFailed(rewardRef);
    return { ...reward, credited: false, reason: "stripe-not-configured" };
  }

  let balanceTransaction;
  try {
    balanceTransaction = await client.customers.createBalanceTransaction(customerId, {
      amount: -amountCents,
      currency: "usd",
      description: "ARK Refer & Save: one month free",
      metadata: {
        purpose: "ark_referral_free_month",
        referrerClientId: referrerId,
        referredClientId: referredId,
      },
    }, { idempotencyKey: `ark-referral-free-month-${referredId}` });
  } catch (error) {
    await markCreditAttemptFailed(rewardRef);
    console.error("Unable to issue the Stripe referral credit", error);
    return { ...reward, credited: false, reason: "provider-credit-failed" };
  }

  const referrerRef = accountRef(db, referrerId);
  const referredRef = accountRef(db, referredId);
  return db.runTransaction(async (transaction) => {
    const [rewardSnapshot, referrerSnapshot, referredSnapshot] = await Promise.all([
      transaction.get(rewardRef),
      transaction.get(referrerRef),
      transaction.get(referredRef),
    ]);
    if (!rewardSnapshot.exists || !referrerSnapshot.exists) return { ...reward, credited: false, reason: "account-not-found" };
    const savedReward = rewardSnapshot.data();
    if (savedReward.rewardStatus === "credited") return { ...rewardRecordResult(savedReward), idempotent: true };
    const account = referrerSnapshot.data();
    if (billingProvider(account) !== REFERRAL_REWARD_PROVIDER || text(account.stripeCustomerId) !== customerId) {
      return { ...rewardRecordResult(savedReward), credited: false, reason: "billing-provider-changed" };
    }

    const timestamp = FieldValue.serverTimestamp();
    transaction.set(rewardRef, {
      rewardStatus: "credited",
      stripeCustomerBalanceTransactionId: text(balanceTransaction.id),
      creditedAt: timestamp,
      rewardLastAttemptAt: timestamp,
      rewardAttemptCount: FieldValue.increment(1),
      updatedAt: timestamp,
    }, { merge: true });
    transaction.set(referrerRef, {
      referralFreeMonthsPending: Math.max(0, whole(account.referralFreeMonthsPending) - 1),
      referralFreeMonthsCredited: FieldValue.increment(1),
      referralRewardCreditCentsPending: Math.max(0, whole(account.referralRewardCreditCentsPending) - amountCents),
      referralRewardCreditCentsIssued: FieldValue.increment(amountCents),
      lastReferralRewardAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });
    if (referredSnapshot.exists) {
      transaction.set(referredRef, {
        referralRewardStatus: "credited",
        referralRewardProcessedAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
    }
    return { ...rewardRecordResult({ ...savedReward, rewardStatus: "credited" }), credited: true };
  });
}

export async function completeReferralReward({ db, referredClientId, referralCode, stripe }) {
  const referredId = normalizeClientId(referredClientId);
  const referrerId = normalizeClientId(referralCode);
  if (!referredId || !referrerId || referredId === referrerId) {
    return { recorded: false, rewarded: false, reason: referredId === referrerId ? "self-referral" : "missing-referrer" };
  }

  const referrerRef = accountRef(db, referrerId);
  const referredRef = accountRef(db, referredId);
  const recordRef = systemCollection(db, "referrals").doc(referredId);
  const saved = await db.runTransaction(async (transaction) => {
    const [referrerSnapshot, referredSnapshot, recordSnapshot] = await Promise.all([
      transaction.get(referrerRef),
      transaction.get(referredRef),
      transaction.get(recordRef),
    ]);
    if (recordSnapshot.exists) return { ...rewardRecordResult(recordSnapshot.data()), idempotent: true };
    if (!referrerSnapshot.exists || text(referrerSnapshot.data().status) !== "active") {
      return { recorded: false, rewarded: false, reason: "invalid-referrer" };
    }
    if (!referredSnapshot.exists || text(referredSnapshot.data().status) !== "active") {
      return { recorded: false, rewarded: false, reason: "referred-account-not-active" };
    }

    const referrer = referrerSnapshot.data();
    const provider = billingProvider(referrer);
    const rewardAmountCents = referralRewardAmountCents(referrer);
    const stripeCustomerId = text(referrer.stripeCustomerId);
    const eligible = provider === REFERRAL_REWARD_PROVIDER
      && Boolean(stripeCustomerId && text(referrer.stripeSubscriptionId) && rewardAmountCents);
    const timestamp = FieldValue.serverTimestamp();
    const rewardStatus = eligible ? "pending-provider-credit" : "not-eligible";
    const record = {
      referrerClientId: referrerId,
      referredClientId: referredId,
      qualified: true,
      rewarded: eligible,
      rewardKind: REFERRAL_REWARD_KIND,
      rewardProvider: eligible ? REFERRAL_REWARD_PROVIDER : provider,
      rewardAmountCents: eligible ? rewardAmountCents : 0,
      rewardCurrency: "usd",
      rewardStatus,
      stripeCustomerId: eligible ? stripeCustomerId : "",
      status: "completed",
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    transaction.create(recordRef, record);
    transaction.set(referredRef, {
      referredByClientId: referrerId,
      referralRewardStatus: rewardStatus,
      referralRewardProcessedAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });
    if (eligible) {
      transaction.set(referrerRef, {
        referralFreeMonthsEarned: FieldValue.increment(1),
        referralFreeMonthsPending: FieldValue.increment(1),
        referralRewardCreditCentsPending: FieldValue.increment(rewardAmountCents),
        updatedAt: timestamp,
      }, { merge: true });
    }
    return rewardRecordResult(record);
  });

  if (!saved.rewarded || saved.credited || saved.rewardStatus !== "pending-provider-credit") return saved;
  return applyStripeReferralCredit({ db, stripe, rewardRef: recordRef, reward: saved });
}

export async function retryPendingStripeReferralRewards({ db, stripe, limit = 100 }) {
  const maximum = Math.max(1, Math.min(100, whole(limit) || 100));
  const snapshot = await systemCollection(db, "referrals")
    .where("rewardStatus", "==", "pending-provider-credit")
    .limit(maximum)
    .get();
  const results = [];
  for (const document of snapshot.docs) {
    results.push(await applyStripeReferralCredit({
      db,
      stripe,
      rewardRef: document.ref,
      reward: rewardRecordResult(document.data()),
    }));
  }
  return results;
}
