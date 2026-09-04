import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeNotificationChannels,
  normalizeNotificationPreferences,
  notificationPreferenceError,
  NOTIFICATION_SMS_FROM_E164,
} from "../app/lib/notificationPreferences.js";
import {
  publicReferralRewardSummary,
  referralRewardAmountCents,
  REFERRAL_REWARD_KIND,
  REFERRAL_REWARD_PROVIDER,
} from "../app/lib/referralRewards.js";

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
  assert.ok(settings.includes("nativeApp === false &&"));
  assert.ok(settings.includes('id="email-alerts"'));
  assert.ok(settings.includes('id="text-alerts"'));
});

test("feedback is saved without issuing a reward", async () => {
  const [route, page] = await Promise.all([
    source("app/api/feedback/route.js"),
    source("app/feedback/page.js"),
  ]);
  assert.ok(route.includes('type: "feedback"'));
  assert.ok(page.includes('setNotice("Feedback sent.")'));
  assert.equal(route.includes("feedbackReward"), false);
  assert.equal(route.includes("rewardLead"), false);
  assert.equal(page.includes("rewardGranted"), false);
  assert.equal(page.toLowerCase().includes("free lead"), false);
});

test("each qualifying Stripe referral credits one current-plan month", async () => {
  assert.equal(REFERRAL_REWARD_KIND, "free-subscription-month");
  assert.equal(REFERRAL_REWARD_PROVIDER, "stripe");
  assert.equal(referralRewardAmountCents({ billingPlanKey: "scale" }), 16_999);
  assert.deepEqual(publicReferralRewardSummary({
    billingProvider: "stripe",
    billingPlanKey: "scale",
    referralFreeMonthsEarned: 4,
    referralFreeMonthsPending: 1,
    referralFreeMonthsCredited: 3,
  }), {
    billingProvider: "stripe",
    referralRewardAvailable: true,
    referralFreeMonthsEarned: 4,
    referralFreeMonthsPending: 1,
    referralFreeMonthsCredited: 3,
    referralPlanName: "Scale",
    referralPlanAmountCents: 16_999,
  });
  assert.equal(publicReferralRewardSummary({ billingProvider: "apple" }).referralRewardAvailable, false);

  const [rewards, stripeActivation, appleActivation, billingSync, signup, page, dashboard] = await Promise.all([
    source("app/lib/referralRewards.js"),
    source("app/lib/ownerPaymentSetup.js"),
    source("app/lib/ownerApplePaymentSetup.js"),
    source("app/api/cron/billing-sync/route.js"),
    source("app/signup/page.js"),
    source("app/rewards/page.js"),
    source("app/components/ClientStats.js"),
  ]);
  assert.ok(rewards.includes("customers.createBalanceTransaction"));
  assert.ok(rewards.includes("amount: -amountCents"));
  assert.ok(rewards.includes("ark-referral-free-month-${referredId}"));
  assert.ok(rewards.includes("referralFreeMonthsEarned: FieldValue.increment(1)"));
  assert.equal(rewards.includes("REFERRAL_REWARDS_PER_MONTH"), false);
  assert.ok(stripeActivation.includes("completeReferralReward"));
  assert.ok(appleActivation.includes("completeReferralReward"));
  assert.ok(billingSync.includes("retryPendingStripeReferralRewards"));
  assert.ok(signup.includes("referralCode"));
  assert.ok(page.includes("Refer one business"));
  assert.ok(page.includes("Get one month free."));
  assert.ok(page.includes("Copy invite link"));
  assert.ok(dashboard.includes("function ReferralCornerButton"));
  assert.ok(dashboard.includes("fixed z-40"));
  assert.ok(dashboard.includes("--ark-bottom-scroll-clearance"));
  assert.ok(dashboard.includes("--ark-safe-area-right"));
  assert.ok(dashboard.includes("Refer & Save"));
  assert.ok(dashboard.includes("Refer one person. Get one month free."));
  assert.equal(dashboard.includes('<DashboardCard value="" label="Refer & Save"'), false);
});

test("the retired free-lead reward path is removed", async () => {
  const [manager, dashboard, planSummary, profile, help, terms] = await Promise.all([
    source("app/components/PaymentManagementPanel.js"),
    source("app/components/ClientStats.js"),
    source("app/api/billing/plan-summary/route.js"),
    source("app/api/account/profile/route.js"),
    source("app/lib/helpContent.js"),
    source("app/terms/page.js"),
  ]);
  await assert.rejects(access(new URL("app/api/billing/reward-credits/route.js", root)));
  await assert.rejects(access(new URL("app/lib/rewardLeadCredits.js", root)));
  for (const content of [manager, dashboard, planSummary, profile, help, terms]) {
    assert.equal(content.toLowerCase().includes("free lead"), false);
    assert.equal(content.includes("rewardLeadCredit"), false);
  }
  assert.ok(dashboard.includes('label="New Leads"'));
  assert.ok(dashboard.includes('label="Messages"'));
});

test("terms use a seven-day first-payment refund window with provider boundaries", async () => {
  const terms = await source("app/terms/page.js");
  assert.ok(terms.includes("First-payment refund window"));
  assert.ok(terms.includes("within seven calendar days"));
  assert.ok(terms.includes("does not apply to renewals, lead top-ups"));
  assert.ok(terms.includes("Apple controls eligibility"));
});
