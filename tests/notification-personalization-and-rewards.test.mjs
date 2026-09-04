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
  referralOfferAvailable,
  referralOfferExpiration,
  referralRewardAmountCents,
  REFERRAL_OFFER_WINDOW_MS,
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

test("one qualifying referral within a new account's 24-hour window credits one current-plan month", async () => {
  assert.equal(REFERRAL_REWARD_KIND, "free-subscription-month");
  assert.equal(REFERRAL_REWARD_PROVIDER, "stripe");
  assert.equal(REFERRAL_OFFER_WINDOW_MS, 86_400_000);
  assert.equal(referralRewardAmountCents({ billingPlanKey: "scale" }), 16_999);

  const activatedAt = new Date("2026-09-03T12:00:00.000Z");
  const expiresAt = referralOfferExpiration(activatedAt);
  const eligibleAccount = {
    billingProvider: "stripe",
    billingPlanKey: "scale",
    referralOfferExpiresAt: expiresAt,
    referralFreeMonthsEarned: 0,
    referralFreeMonthsPending: 0,
    referralFreeMonthsCredited: 0,
  };
  assert.equal(expiresAt.getTime() - activatedAt.getTime(), REFERRAL_OFFER_WINDOW_MS);
  assert.equal(referralOfferAvailable(eligibleAccount, new Date(expiresAt.getTime() - 1)), true);
  assert.equal(referralOfferAvailable(eligibleAccount, expiresAt), false);
  assert.equal(referralOfferAvailable({ billingProvider: "stripe" }, activatedAt), false);
  assert.equal(referralOfferAvailable({ ...eligibleAccount, referralFreeMonthsEarned: 1 }, activatedAt), false);
  assert.equal(referralOfferAvailable({ ...eligibleAccount, referralFreeMonthsPending: 1 }, activatedAt), false);
  assert.equal(referralOfferAvailable({ ...eligibleAccount, referralFreeMonthsCredited: 1 }, activatedAt), false);
  assert.equal(referralOfferAvailable({ ...eligibleAccount, billingProvider: "apple" }, activatedAt), false);

  assert.deepEqual(publicReferralRewardSummary(eligibleAccount, new Date(expiresAt.getTime() - 1_000)), {
    billingProvider: "stripe",
    referralRewardAvailable: true,
    referralOfferExpiresAt: expiresAt.toISOString(),
    referralOfferRemainingMs: 1_000,
    referralFreeMonthsEarned: 0,
    referralFreeMonthsPending: 0,
    referralFreeMonthsCredited: 0,
    referralPlanName: "Scale",
    referralPlanAmountCents: 16_999,
  });
  assert.equal(publicReferralRewardSummary({ billingProvider: "apple" }).referralRewardAvailable, false);

  const [rewards, stripeActivation, appleActivation, billingSync, signup, page, dashboard, terms, help] = await Promise.all([
    source("app/lib/referralRewards.js"),
    source("app/lib/ownerPaymentSetup.js"),
    source("app/lib/ownerApplePaymentSetup.js"),
    source("app/api/cron/billing-sync/route.js"),
    source("app/signup/page.js"),
    source("app/rewards/page.js"),
    source("app/components/ClientStats.js"),
    source("app/terms/page.js"),
    source("app/lib/helpContent.js"),
  ]);
  assert.ok(rewards.includes("customers.createBalanceTransaction"));
  assert.ok(rewards.includes("amount: -amountCents"));
  assert.ok(rewards.includes("ark-referral-free-month-${referredId}"));
  assert.ok(rewards.includes("referralFreeMonthsEarned: FieldValue.increment(1)"));
  assert.ok(rewards.includes("referralOfferAvailable(referrer, qualificationTime)"));
  assert.equal(rewards.includes("REFERRAL_REWARDS_PER_MONTH"), false);
  assert.ok(stripeActivation.includes("completeReferralReward"));
  assert.ok(stripeActivation.includes("referralOfferExpiresAt"));
  assert.ok(appleActivation.includes("completeReferralReward"));
  assert.ok(billingSync.includes("retryPendingStripeReferralRewards"));
  assert.ok(signup.includes("referralCode"));
  assert.ok(page.includes("Refer one business"));
  assert.ok(page.includes("Get one month free."));
  assert.ok(page.includes("Copy invite link"));
  assert.ok(page.includes("referralOfferRemainingMs"));
  assert.ok(page.includes('router.replace("/")'));
  assert.ok(dashboard.includes("function ReferralCornerButton"));
  assert.ok(dashboard.includes("fixed z-40"));
  assert.equal(dashboard.includes("--ark-bottom-scroll-clearance"), false);
  assert.ok(dashboard.includes("--ark-safe-area-bottom"));
  assert.ok(dashboard.includes("--ark-safe-area-right"));
  assert.ok(dashboard.includes("Refer & Save"));
  assert.ok(dashboard.includes("New account offer · first 24 hours only"));
  assert.ok(dashboard.includes("referralOfferRemainingMs"));
  assert.equal(dashboard.includes('<DashboardCard value="" label="Refer & Save"'), false);
  assert.ok(terms.includes("24 hours after account activation"));
  assert.ok(terms.includes("offer ends permanently"));
  assert.ok(help.includes("one 24-hour chance"));
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

test("terms and in-app guidance state no refunds", async () => {
  const [terms, help, legalKnowledge] = await Promise.all([
    source("app/terms/page.js"),
    source("app/lib/helpContent.js"),
    source("app/lib/legalKnowledge.js"),
  ]);
  for (const content of [terms, help, legalKnowledge]) {
    assert.ok(content.includes("No refunds."));
    assert.equal(content.includes("seven-calendar-day refund-request window"), false);
    assert.equal(content.includes("First-payment refund window"), false);
  }
});
