import { FieldValue } from "firebase-admin/firestore";
import { acceptedLeadAccountPatch, acceptedLeadPlanStatus } from "./acceptedLeadPlanBilling.js";
import { accountBusinessRef, accountRef, systemCollection } from "./firestoreLayout.js";
import { calendarMonthWindow } from "./timeWindows.js";
import { normalizeClientId } from "./valueUtils.js";

export const FEEDBACK_REWARD_LEADS = 5;
export const REFERRAL_REWARD_LEADS = 5;
export const REFERRAL_REWARDS_PER_MONTH = 3;
export const REWARD_REDEMPTION_LEADS = 5;

function text(value) {
  return String(value || "").trim();
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function safeDocumentPart(value) {
  return text(value).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

export function rewardLeadCreditBalance(account = {}) {
  return whole(account.rewardLeadCreditBalance);
}

export function referralPeriodId(clientId, monthKey) {
  return `${safeDocumentPart(clientId)}--${safeDocumentPart(monthKey)}`;
}

export function referralPeriodRef(db, clientId, monthKey) {
  return systemCollection(db, "referralPeriods").doc(referralPeriodId(clientId, monthKey));
}

export function feedbackRewardUpdate(account = {}) {
  if (account.feedbackRewardGrantedAt || account.feedbackRewardGranted === true) {
    return { granted: false, amount: 0, balance: rewardLeadCreditBalance(account) };
  }
  return {
    granted: true,
    amount: FEEDBACK_REWARD_LEADS,
    balance: rewardLeadCreditBalance(account) + FEEDBACK_REWARD_LEADS,
  };
}

export function publicRewardSummary(account = {}, period = {}, monthKey = "") {
  return {
    rewardLeadCreditBalance: rewardLeadCreditBalance(account),
    feedbackRewardEarned: Boolean(account.feedbackRewardGrantedAt || account.feedbackRewardGranted === true),
    referralMonthKey: text(monthKey || period.monthKey),
    completedReferralsThisMonth: whole(period.completedReferralCount),
    rewardedReferralsThisMonth: Math.min(REFERRAL_REWARDS_PER_MONTH, whole(period.rewardedReferralCount)),
    referralRewardsPerMonth: REFERRAL_REWARDS_PER_MONTH,
    referralRewardLeads: REFERRAL_REWARD_LEADS,
  };
}

export async function completeReferralReward({ db, referredClientId, referralCode, now = new Date() }) {
  const referredId = normalizeClientId(referredClientId);
  const referrerId = normalizeClientId(referralCode);
  if (!referredId || !referrerId || referredId === referrerId) {
    return { recorded: false, rewarded: false, reason: referredId === referrerId ? "self-referral" : "missing-referrer" };
  }

  const referrerRef = accountRef(db, referrerId);
  const [initialReferrer, initialBusiness] = await Promise.all([
    referrerRef.get(),
    accountBusinessRef(db, referrerId).get(),
  ]);
  if (!initialReferrer.exists || text(initialReferrer.data().status) !== "active") {
    return { recorded: false, rewarded: false, reason: "invalid-referrer" };
  }
  const month = calendarMonthWindow(text(initialBusiness.exists ? initialBusiness.data().timeZone : initialReferrer.data().timeZone), now);
  const referredRef = accountRef(db, referredId);
  const recordRef = systemCollection(db, "referrals").doc(referredId);
  const periodRef = referralPeriodRef(db, referrerId, month.monthKey);

  return db.runTransaction(async (transaction) => {
    const [referrerSnapshot, referredSnapshot, recordSnapshot, periodSnapshot] = await Promise.all([
      transaction.get(referrerRef),
      transaction.get(referredRef),
      transaction.get(recordRef),
      transaction.get(periodRef),
    ]);
    if (recordSnapshot.exists) {
      const record = recordSnapshot.data();
      return { recorded: true, rewarded: record.rewarded === true, reason: "already-recorded" };
    }
    if (!referrerSnapshot.exists || text(referrerSnapshot.data().status) !== "active") {
      return { recorded: false, rewarded: false, reason: "invalid-referrer" };
    }
    if (!referredSnapshot.exists || text(referredSnapshot.data().status) !== "active") {
      return { recorded: false, rewarded: false, reason: "referred-account-not-active" };
    }

    const period = periodSnapshot.exists ? periodSnapshot.data() : {};
    const rewardedCount = whole(period.rewardedReferralCount);
    const rewarded = rewardedCount < REFERRAL_REWARDS_PER_MONTH;
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(recordRef, {
      referrerClientId: referrerId,
      referredClientId: referredId,
      monthKey: month.monthKey,
      qualified: true,
      rewarded,
      rewardLeadCredits: rewarded ? REFERRAL_REWARD_LEADS : 0,
      status: "completed",
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.set(periodRef, {
      clientId: referrerId,
      referrerClientId: referrerId,
      monthKey: month.monthKey,
      completedReferralCount: FieldValue.increment(1),
      ...(rewarded ? { rewardedReferralCount: FieldValue.increment(1) } : {}),
      updatedAt: timestamp,
      ...(!periodSnapshot.exists ? { createdAt: timestamp } : {}),
    }, { merge: true });
    transaction.set(referredRef, {
      referredByClientId: referrerId,
      referralRewardStatus: rewarded ? "rewarded" : "monthly-limit-reached",
      referralRewardProcessedAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });
    if (rewarded) {
      transaction.set(referrerRef, {
        rewardLeadCreditBalance: FieldValue.increment(REFERRAL_REWARD_LEADS),
        rewardLeadCreditsEarnedTotal: FieldValue.increment(REFERRAL_REWARD_LEADS),
        lastReferralRewardAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
    }
    return { recorded: true, rewarded, rewardLeadCredits: rewarded ? REFERRAL_REWARD_LEADS : 0, monthKey: month.monthKey };
  });
}

export async function redeemRewardLeadCredits({ db, clientId, requestId, now = new Date() }) {
  const safeClientId = normalizeClientId(clientId);
  const safeRequestId = safeDocumentPart(requestId);
  if (!safeClientId || !safeRequestId) throw new Error("REWARD_REDEMPTION_INVALID");
  const ownerRef = accountRef(db, safeClientId);
  const receiptRef = ownerRef.collection("rewardLeadCreditRedemptions").doc(safeRequestId);

  return db.runTransaction(async (transaction) => {
    const [accountSnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(ownerRef),
      transaction.get(receiptRef),
    ]);
    if (receiptSnapshot.exists) return { ...receiptSnapshot.data(), idempotent: true };
    if (!accountSnapshot.exists || text(accountSnapshot.data().status) !== "active") throw new Error("REWARD_REDEMPTION_FORBIDDEN");
    const account = accountSnapshot.data();
    if (account.billingPastDue === true) throw new Error("REWARD_REDEMPTION_PAYMENT_REQUIRED");
    const current = acceptedLeadPlanStatus(account, now);
    if (!current.limitReached) throw new Error("REWARD_REDEMPTION_LIMIT_NOT_REACHED");
    const currentBalance = rewardLeadCreditBalance(account);
    if (currentBalance < REWARD_REDEMPTION_LEADS) throw new Error("REWARD_REDEMPTION_BALANCE_LOW");

    const nextAccount = {
      ...account,
      acceptedLeadTopUpPeriodKey: current.periodKey,
      acceptedLeadTopUpsThisPeriod: current.acceptedLeadTopUps + REWARD_REDEMPTION_LEADS,
    };
    const nextStatus = acceptedLeadPlanStatus(nextAccount, now);
    const nextBalance = currentBalance - REWARD_REDEMPTION_LEADS;
    const timestamp = FieldValue.serverTimestamp();
    const receipt = {
      clientId: safeClientId,
      requestId: safeRequestId,
      acceptedLeadPeriodKey: current.periodKey,
      acceptedLeadsAdded: REWARD_REDEMPTION_LEADS,
      balanceBefore: currentBalance,
      balanceAfter: nextBalance,
      status: "applied",
      createdAt: timestamp,
    };
    transaction.set(ownerRef, {
      ...acceptedLeadAccountPatch(nextStatus),
      rewardLeadCreditBalance: nextBalance,
      rewardLeadCreditsRedeemedTotal: FieldValue.increment(REWARD_REDEMPTION_LEADS),
      lastRewardLeadCreditRedemptionAt: timestamp,
    }, { merge: true });
    transaction.create(receiptRef, receipt);
    return { ...receipt, createdAt: now, idempotent: false };
  });
}
