import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeNotificationChannels,
  normalizeNotificationPreferences,
  notificationPreferenceError,
  NOTIFICATION_SMS_FROM_E164,
} from "../app/lib/notificationPreferences.js";
import {
  FEEDBACK_REWARD_LEADS,
  feedbackRewardUpdate,
  publicRewardSummary,
  REFERRAL_REWARD_LEADS,
  REFERRAL_REWARDS_PER_MONTH,
  REWARD_REDEMPTION_LEADS,
} from "../app/lib/rewardLeadCredits.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("notification personalization accepts email, SMS, or both and requires one", () => {
  const contacts = { accountEmail: "Owner@Example.com", accountPhone: "(508) 555-0100" };
  assert.deepEqual(normalizeNotificationChannels(["sms", "email", "sms", "unknown"]), ["email", "sms"]);
  assert.deepEqual(normalizeNotificationPreferences({
    notificationChannels: ["sms"],
    notificationPreferencesCompleted: true,
  }, contacts), {
    notificationChannels: ["sms"],
    notificationEmail: "owner@example.com",
    notificationPhone: "+15085550100",
    notificationPreferencesCompleted: true,
  });
  assert.equal(notificationPreferenceError({ notificationChannels: [] }, contacts), "Choose email, text message, or both.");
  assert.equal(notificationPreferenceError({ notificationChannels: ["email", "sms"] }, contacts), "");
  assert.equal(NOTIFICATION_SMS_FROM_E164, "+17742316164");
});

test("selected owner notifications reuse the signup sender and cover existing alert events", async () => {
  const [delivery, notifications, messages, telnyx, setup, settings] = await Promise.all([
    source("app/lib/customerNotificationDelivery.js"),
    source("app/lib/notificationService.js"),
    source("app/lib/messageNotificationService.js"),
    source("app/lib/telnyxSystemText.js"),
    source("SETUP.md"),
    source("app/components/SettingsPanel.js"),
  ]);
  assert.ok(delivery.includes("sendTelnyxSystemText"));
  assert.ok(delivery.includes("https://api.resend.com/emails"));
  assert.ok(delivery.includes("notificationPreferencesCompleted"));
  assert.ok(telnyx.includes("process.env.TELNYX_SIGNUP_FROM_NUMBER"));
  assert.ok(setup.includes("TELNYX_SIGNUP_FROM_NUMBER` must remain `+17742316164`"));
  assert.ok(notifications.includes("sendPreferredAccountNotification"));
  for (const type of ["new-lead", "request-status"]) assert.ok(notifications.includes(`type: "${type}"`));
  assert.ok(messages.includes("sendPreferredAccountNotification"));
  assert.ok(settings.includes("Notification delivery"));
  assert.ok(settings.includes("NOTIFICATION_SMS_FROM_DISPLAY"));
});

test("the first feedback reward is one-time and does not depend on positive sentiment", async () => {
  assert.equal(FEEDBACK_REWARD_LEADS, 5);
  assert.deepEqual(feedbackRewardUpdate({ rewardLeadCreditBalance: 45 }), { granted: true, amount: 5, balance: 50 });
  assert.deepEqual(feedbackRewardUpdate({ rewardLeadCreditBalance: 50, feedbackRewardGranted: true }), { granted: false, amount: 0, balance: 50 });
  const [route, page] = await Promise.all([source("app/api/feedback/route.js"), source("app/feedback/page.js")]);
  assert.ok(route.includes("feedbackRewardUpdate(account)"));
  assert.ok(route.includes("feedbackRewardGrantedAt"));
  assert.equal(route.includes('sentiment.key === "positive"'), false);
  assert.ok(page.includes("mystery thank-you"));
  assert.ok(page.includes("data.rewardGranted"));
});

test("referrals reward the first three paid activations each month and credits remain banked", async () => {
  assert.equal(REFERRAL_REWARD_LEADS, 5);
  assert.equal(REFERRAL_REWARDS_PER_MONTH, 3);
  assert.equal(REWARD_REDEMPTION_LEADS, 5);
  assert.deepEqual(publicRewardSummary(
    { rewardLeadCreditBalance: 50, feedbackRewardGranted: true },
    { completedReferralCount: 8, rewardedReferralCount: 9 },
    "2026-09",
  ), {
    rewardLeadCreditBalance: 50,
    feedbackRewardEarned: true,
    referralMonthKey: "2026-09",
    completedReferralsThisMonth: 8,
    rewardedReferralsThisMonth: 3,
    referralRewardsPerMonth: 3,
    referralRewardLeads: 5,
  });
  const [rewards, stripeActivation, appleActivation, signup, page] = await Promise.all([
    source("app/lib/rewardLeadCredits.js"),
    source("app/lib/ownerPaymentSetup.js"),
    source("app/lib/ownerApplePaymentSetup.js"),
    source("app/signup/page.js"),
    source("app/rewards/page.js"),
  ]);
  assert.ok(rewards.includes("rewardedCount < REFERRAL_REWARDS_PER_MONTH"));
  assert.ok(rewards.includes("transaction.create(recordRef"));
  assert.ok(stripeActivation.includes("completeReferralReward"));
  assert.ok(appleActivation.includes("completeReferralReward"));
  assert.ok(signup.includes("referralCode"));
  assert.ok(page.includes("first three completed paid referrals"));
});

test("free lead credits can be applied only after the included allowance is exhausted", async () => {
  const [logic, route, manager, dashboard] = await Promise.all([
    source("app/lib/rewardLeadCredits.js"),
    source("app/api/billing/reward-credits/route.js"),
    source("app/components/PaymentManagementPanel.js"),
    source("app/components/ClientStats.js"),
  ]);
  assert.ok(logic.includes("if (!current.limitReached)"));
  assert.ok(logic.includes("currentBalance < REWARD_REDEMPTION_LEADS"));
  assert.ok(logic.includes("rewardLeadCreditBalance: nextBalance"));
  assert.ok(route.includes("redeemRewardLeadCredits"));
  assert.ok(manager.includes("Use 5 free leads"));
  assert.ok(manager.includes("!planSummary?.limitReached"));
  assert.ok(dashboard.includes('label="Rewards"'));
  assert.ok(dashboard.includes('value="★"'));
});

test("terms use a seven-day first-payment refund window with provider boundaries", async () => {
  const terms = await source("app/terms/page.js");
  assert.ok(terms.includes("First-payment refund window"));
  assert.ok(terms.includes("within seven calendar days"));
  assert.ok(terms.includes("does not apply to renewals, lead top-ups"));
  assert.ok(terms.includes("Apple controls eligibility"));
});
