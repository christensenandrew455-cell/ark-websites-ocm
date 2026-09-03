import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireUser } from "../../../lib/userRequest";
import { BILLING_PLAN_KEYS, BILLING_VERSION, billingPlan } from "../../../lib/billingPricing";
import { getAdminDb } from "../../../lib/firebase-admin";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import {
  ensureStripePlanPrice,
  stripeBillingPlanFromSubscription,
  stripeSubscriptionAccountFields,
} from "../../../lib/stripePlanBilling";
import { billingPromotion, discountedAmountCents } from "../../../lib/temporaryFeatures";
import { calendarMonthWindow, subscriptionPeriodWindow } from "../../../lib/timeWindows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function objectId(value) {
  return text(value?.id || value);
}

function requestedPlanKey(value) {
  const candidate = text(value).toLowerCase();
  return BILLING_PLAN_KEYS.includes(candidate) ? candidate : "";
}

function validRequestId(value) {
  const candidate = text(value);
  return /^[a-z0-9][a-z0-9_-]{7,99}$/i.test(candidate) ? candidate : "";
}

async function activeStripeAccount(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization;
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const snapshot = await accountRef.get();
  if (!snapshot.exists) {
    return { response: NextResponse.json({ error: "This account could not be found." }, { status: 404 }) };
  }
  const account = snapshot.data();
  if (text(account.status) !== "active" || account.billingPastDue === true) {
    return { response: NextResponse.json({ error: "Update the payment method before changing plans." }, { status: 409 }) };
  }
  if (text(account.billingProvider || "stripe") !== "stripe") {
    return { response: NextResponse.json({ error: "Manage this plan through Apple." }, { status: 409 }) };
  }
  if (!text(account.stripeCustomerId) || !text(account.stripeSubscriptionId)) {
    return { response: NextResponse.json({ error: "The Stripe subscription is not connected. Contact support." }, { status: 409 }) };
  }
  return { ...authorization, db, accountRef, account };
}

async function releaseSchedule(stripe, subscription) {
  const scheduleId = objectId(subscription.schedule);
  if (!scheduleId) return;
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  if (["active", "not_started"].includes(schedule.status)) {
    await stripe.subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true });
  }
}

function subscriptionMetadata(account, currentMetadata, plan) {
  const promotion = billingPromotion(account.billingPromotionKey || currentMetadata?.billingPromotion);
  return {
    ...(currentMetadata || {}),
    clientId: text(account.clientId || currentMetadata?.clientId),
    uid: text(account.uid || currentMetadata?.uid),
    businessName: text(account.businessName || currentMetadata?.businessName),
    billingPlan: plan.key,
    billingVersion: BILLING_VERSION,
    monthlyAcceptedLeads: String(plan.monthlyAcceptedLeads),
    monthlyCalls: String(plan.monthlyCalls),
    ...(promotion ? {
      billingPromotion: promotion.key,
      billingDiscountPercent: String(promotion.percentOff),
      billingSalesChannel: "web",
    } : {}),
  };
}

function scheduleDiscounts(account, subscription) {
  const promotion = billingPromotion(account.billingPromotionKey || subscription.metadata?.billingPromotion);
  return promotion ? [{ coupon: promotion.stripeCouponId }] : undefined;
}

function subscriptionItems(subscription) {
  return (subscription.items?.data || []).map((item) => ({
    price: objectId(item.price),
    quantity: Math.max(1, Number(item.quantity || 1)),
  })).filter((item) => item.price);
}

function latestInvoice(subscription) {
  return subscription?.latest_invoice && typeof subscription.latest_invoice === "object"
    ? subscription.latest_invoice
    : null;
}

function publicImmediateResult(subscription, publishableKey) {
  const invoice = latestInvoice(subscription);
  const clientSecret = text(invoice?.confirmation_secret?.client_secret);
  if (subscription.pending_update && clientSecret) {
    return {
      status: "requires_action",
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      clientSecret,
      publishableKey,
    };
  }
  if (subscription.pending_update) {
    return {
      status: "payment_failed",
      subscriptionId: subscription.id,
      invoiceId: invoice?.id || "",
      error: "The plan payment did not complete. Update the card or try again.",
    };
  }
  return { status: "succeeded", subscriptionId: subscription.id, invoiceId: invoice?.id || "" };
}

export async function POST(request) {
  const access = await activeStripeAccount(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({}));
  const planKey = requestedPlanKey(body.planKey);
  const timing = text(body.timing).toLowerCase();
  const requestId = validRequestId(body.requestId);
  if (!planKey || !["renewal", "now"].includes(timing) || !requestId) {
    return NextResponse.json({ error: "Choose a plan and when it should start." }, { status: 400 });
  }
  if (planKey === text(access.account.billingPlanKey)) {
    return NextResponse.json({ error: `You are already on the ${billingPlan(planKey).name} plan.` }, { status: 409 });
  }
  const rateLimit = await checkRequestRateLimit({ db: access.db, request, scope: `plan-change:${access.clientId}`, limit: 12, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  const publishableKey = text(process.env.STRIPE_PUBLISHABLE_KEY);
  if (!stripeSecretKey || !publishableKey) {
    return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    let subscription = await stripe.subscriptions.retrieve(text(access.account.stripeSubscriptionId), {
      expand: ["items.data.price", "items.data.price.product", "latest_invoice.confirmation_secret"],
    });
    if (objectId(subscription.customer) !== text(access.account.stripeCustomerId)) {
      return NextResponse.json({ error: "The Stripe subscription does not match this account." }, { status: 409 });
    }
    const target = await ensureStripePlanPrice({ stripe, planKey });
    const targetPlan = target.plan;
    const promotion = billingPromotion(access.account.billingPromotionKey || subscription.metadata?.billingPromotion);
    const targetAmountCents = discountedAmountCents(targetPlan.amountCents, promotion);

    await releaseSchedule(stripe, subscription);
    subscription = await stripe.subscriptions.retrieve(subscription.id, {
      expand: ["items.data.price", "items.data.price.product", "latest_invoice.confirmation_secret"],
    });

    if (timing === "renewal") {
      const fallback = calendarMonthWindow(text(access.account.timeZone));
      const period = subscriptionPeriodWindow(subscription, fallback);
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
      }, { idempotencyKey: `ark-plan-renewal-${subscription.id}-${requestId}` });
      const phaseStart = Number(schedule.current_phase?.start_date || Math.floor(period.startMs / 1000));
      const phaseEnd = Number(schedule.current_phase?.end_date || Math.floor(period.endMs / 1000));
      const discounts = scheduleDiscounts(access.account, subscription);
      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        metadata: {
          managedBy: "ark-client-center",
          clientId: access.clientId,
          pendingBillingPlan: targetPlan.key,
          billingVersion: BILLING_VERSION,
        },
        proration_behavior: "none",
        phases: [
          {
            start_date: phaseStart,
            end_date: phaseEnd,
            items: subscriptionItems(subscription),
            metadata: subscription.metadata || {},
            proration_behavior: "none",
            ...(discounts ? { discounts } : {}),
          },
          {
            start_date: phaseEnd,
            duration: { interval: "month", interval_count: 1 },
            items: [{ price: target.priceId, quantity: 1 }],
            metadata: subscriptionMetadata(access.account, subscription.metadata, targetPlan),
            proration_behavior: "none",
            ...(discounts ? { discounts } : {}),
          },
        ],
      });
      await access.accountRef.set({
        pendingBillingPlanKey: targetPlan.key,
        pendingBillingPlanName: targetPlan.name,
        pendingBillingPlanStartsAt: Timestamp.fromMillis(period.endMs),
        pendingBillingPlanTiming: "renewal",
        stripeSubscriptionScheduleId: schedule.id,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return NextResponse.json({
        status: "scheduled",
        timing,
        planKey: targetPlan.key,
        planName: targetPlan.name,
        startsAt: new Date(period.endMs).toISOString(),
        monthlyPriceCents: targetAmountCents,
      });
    }

    const items = (subscription.items?.data || []).map((item, index) => index === 0
      ? { id: item.id, price: target.priceId, quantity: 1 }
      : { id: item.id, deleted: true });
    if (!items.length) items.push({ price: target.priceId, quantity: 1 });
    const updated = await stripe.subscriptions.update(subscription.id, {
      items,
      billing_cycle_anchor: "now",
      proration_behavior: "none",
      payment_behavior: "pending_if_incomplete",
      cancel_at_period_end: false,
      metadata: subscriptionMetadata(access.account, subscription.metadata, targetPlan),
      expand: ["items.data.price", "items.data.price.product", "latest_invoice.confirmation_secret"],
    }, { idempotencyKey: `ark-plan-now-${subscription.id}-${requestId}` });
    const result = publicImmediateResult(updated, publishableKey);
    if (result.status === "succeeded") {
      const synced = stripeSubscriptionAccountFields(updated, access.account);
      await access.accountRef.set(synced.patch, { merge: true });
    } else {
      await access.accountRef.set({
        pendingBillingPlanKey: targetPlan.key,
        pendingBillingPlanName: targetPlan.name,
        pendingBillingPlanStartsAt: FieldValue.serverTimestamp(),
        pendingBillingPlanTiming: "immediate_payment",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return NextResponse.json({
      ...result,
      timing,
      planKey: targetPlan.key,
      planName: targetPlan.name,
      monthlyPriceCents: targetAmountCents,
    }, { status: result.status === "payment_failed" ? 402 : 200 });
  } catch (error) {
    console.error("Unable to change Stripe plan", error);
    return NextResponse.json({ error: "The plan change could not be completed. Update the card or try again." }, { status: 500 });
  }
}

export async function PUT(request) {
  const access = await activeStripeAccount(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({}));
  const subscriptionId = text(body.subscriptionId);
  const planKey = requestedPlanKey(body.planKey);
  if (subscriptionId !== text(access.account.stripeSubscriptionId) || !planKey) {
    return NextResponse.json({ error: "The plan payment could not be verified." }, { status: 400 });
  }
  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  if (!stripeSecretKey) return NextResponse.json({ error: "Stripe billing is not configured yet." }, { status: 503 });
  try {
    const stripe = new Stripe(stripeSecretKey);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price", "items.data.price.product", "latest_invoice.confirmation_secret"],
    });
    const result = publicImmediateResult(subscription, text(process.env.STRIPE_PUBLISHABLE_KEY));
    const currentPlan = stripeBillingPlanFromSubscription(subscription);
    if (result.status !== "succeeded" || currentPlan.key !== planKey) {
      return NextResponse.json({
        ...result,
        error: result.error || "The plan payment has not completed yet.",
      }, { status: 402 });
    }
    const synced = stripeSubscriptionAccountFields(subscription, access.account);
    await access.accountRef.set(synced.patch, { merge: true });
    return NextResponse.json({
      status: "succeeded",
      planKey: synced.plan.key,
      planName: synced.plan.name,
      periodEndAt: new Date(synced.period.endMs).toISOString(),
    });
  } catch (error) {
    console.error("Unable to verify Stripe plan change", error);
    return NextResponse.json({ error: "The plan payment could not be verified. Refresh and try again." }, { status: 400 });
  }
}
