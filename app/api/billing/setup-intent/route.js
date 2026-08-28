import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { isStandardRole } from "../../../lib/accountRoles";
import { billingPlan, normalizeBillingPlanKey, publicBillingPlans } from "../../../lib/billingPricing";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import {
  deletePendingOwnerSignup,
  pendingOwnerSignupAccount,
  pendingOwnerSignupExpired,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "../../../lib/pendingOwnerSignup";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { ensureStripeBillingCatalog, missingStripeResource } from "../../../lib/stripePlanBilling";
import {
  promotionBillingFields,
  publicPromotion,
  webSignupPromotionForRequest,
} from "../../../lib/temporaryFeatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function paymentFailure() { return "Your payment setup could not be completed. Update the payment method or try again."; }
function stripeKeyMode(value, prefix) {
  const key = text(value);
  if (key.startsWith(`${prefix}_live_`)) return "live";
  if (key.startsWith(`${prefix}_test_`)) return "test";
  return "";
}
async function reusableStripeCustomer(stripe, customerId, livemode) {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted !== true && customer.livemode === livemode ? customer : null;
  } catch (error) {
    if (missingStripeResource(error)) return null;
    throw error;
  }
}
async function reusableSetupIntent(stripe, setupIntentId, customerId, uid, planKey, promotionKey, livemode) {
  if (!setupIntentId) return null;
  try {
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    return setupIntent.livemode === livemode
      && text(setupIntent.customer) === customerId
      && text(setupIntent.metadata?.uid) === uid
      && normalizeBillingPlanKey(setupIntent.metadata?.billingPlan) === planKey
      && text(setupIntent.metadata?.billingPromotion) === promotionKey
      && !["canceled", "succeeded"].includes(setupIntent.status)
      ? setupIntent
      : null;
  } catch (error) {
    if (missingStripeResource(error)) return null;
    throw error;
  }
}
function applicationReturnUrl(request) {
  return new URL("/signup/payment", new URL(request.url).origin).toString();
}

async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: paymentFailure() }, { status: 401 }) };
  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(token, true);
    if (!isStandardRole(decoded.role) || decoded.temporaryAccount !== true || text(decoded.accountStatus) !== "pending_payment") {
      return { response: NextResponse.json({ error: paymentFailure() }, { status: 403 }) };
    }
    const db = getAdminDb();
    const pending = await readPendingOwnerSignup({ db, uid: decoded.uid, allowExpired: true });
    if (pending && pendingOwnerSignupExpired(pending.data)) {
      await deletePendingOwnerSignup({ db, auth, uid: decoded.uid, pending });
      return { response: NextResponse.json({ error: paymentFailure() }, { status: 403 }) };
    }
    if (!pending || !pendingOwnerSignupVerified(pending.data) || text(pending.data.stage) !== "pending_payment") {
      return { response: NextResponse.json({ error: paymentFailure() }, { status: 403 }) };
    }
    return { auth, db, decoded, pending };
  } catch {
    return { response: NextResponse.json({ error: paymentFailure() }, { status: 401 }) };
  }
}

export async function POST(request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({}));
  const planKey = normalizeBillingPlanKey(body.planKey);
  const selectedPlan = billingPlan(planKey);
  const stripeSecretKey = text(process.env.STRIPE_SECRET_KEY);
  const stripePublishableKey = text(process.env.STRIPE_PUBLISHABLE_KEY);
  const secretMode = stripeKeyMode(stripeSecretKey, "sk");
  const publishableMode = stripeKeyMode(stripePublishableKey, "pk");
  if (!stripeSecretKey || !stripePublishableKey || !secretMode || secretMode !== publishableMode) {
    console.error("Stripe onboarding keys are missing or mix test and live modes.");
    return NextResponse.json({ error: paymentFailure() }, { status: 503 });
  }

  try {
    const uid = access.decoded.uid;
    const pending = access.pending.data;
    const account = pendingOwnerSignupAccount(pending);
    const payment = pending.payment || {};
    const clientId = text(pending.clientId);
    const promotion = webSignupPromotionForRequest(request, payment.billingPromotionKey);
    const promotionKey = promotion?.key || "";
    const discountFields = promotionBillingFields(selectedPlan, promotion);
    const stripeMetadata = {
      uid,
      clientId,
      businessName: text(account.businessName || clientId),
      accountType: "owner",
      accountStatus: "temporary",
      billingPlan: planKey,
      billingPromotion: promotionKey,
      billingDiscountPercent: promotion ? String(promotion.percentOff) : "",
      billingSalesChannel: promotion ? "web" : "",
    };
    const rateLimit = await checkRequestRateLimit({ db: access.db, request, scope: `payment-setup:${uid}`, limit: 12, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const stripe = new Stripe(stripeSecretKey);
    const livemode = secretMode === "live";
    if (livemode) {
      const stripeAccount = await stripe.accounts.retrieveCurrent();
      if (stripeAccount.charges_enabled !== true) {
        console.error("Stripe live payments are not enabled for this account.", {
          disabledReason: text(stripeAccount.requirements?.disabled_reason),
          currentlyDue: stripeAccount.requirements?.currently_due || [],
          pendingVerification: stripeAccount.requirements?.pending_verification || [],
        });
        return NextResponse.json({
          error: "Stripe is connected, but live payments are not enabled yet. Finish the required setup shown in Stripe, then try again.",
        }, { status: 503 });
      }
    }
    await ensureStripeBillingCatalog({ stripe, planKey });
    let stripeCustomerId = text(payment.stripeCustomerId);
    const existingCustomer = await reusableStripeCustomer(stripe, stripeCustomerId, livemode);
    if (!existingCustomer) {
      const customer = await stripe.customers.create({
        email: text(account.accountEmail),
        name: text(account.ownerName),
        phone: text(account.accountPhone),
        metadata: stripeMetadata,
      }, { idempotencyKey: `ark-onboarding-customer-${uid}` });
      stripeCustomerId = customer.id;
    } else {
      await stripe.customers.update(stripeCustomerId, {
        email: text(account.accountEmail),
        name: text(account.ownerName),
        phone: text(account.accountPhone),
        metadata: stripeMetadata,
      });
    }

    const existingSetupIntentId = text(payment.stripeSetupIntentId);
    let setupIntent = await reusableSetupIntent(stripe, existingSetupIntentId, stripeCustomerId, uid, planKey, promotionKey, livemode);
    const setupAttempts = Math.max(1, Math.floor(Number(payment.setupAttempts || payment.paymentSetupAttempt || 0)) + (setupIntent ? 0 : 1));
    if (!setupIntent) {
      setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: {
          uid,
          clientId,
          purpose: "ark_onboarding_payment_method",
          billingPlan: planKey,
          billingPromotion: promotionKey,
          billingDiscountPercent: promotion ? String(promotion.percentOff) : "",
          billingSalesChannel: promotion ? "web" : "",
        },
      }, { idempotencyKey: `ark-onboarding-setup-${uid}-${planKey}-${promotionKey || "regular"}-${setupAttempts}` });
    }
    if (setupIntent.livemode !== livemode) throw new Error("STRIPE_MODE_MISMATCH");

    await access.pending.ref.set({
      payment: {
        status: "in_progress",
        billingPlanKey: planKey,
        stripeCustomerId,
        stripeSetupIntentId: setupIntent.id,
        stripeLivemode: livemode,
        setupAttempts,
        ...discountFields,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      publishableKey: stripePublishableKey,
      returnUrl: applicationReturnUrl(request),
      selectedPlan,
      plans: publicBillingPlans(),
      promotion: publicPromotion(promotion),
    });
  } catch (error) {
    console.error("Unable to create Stripe SetupIntent", error);
    return NextResponse.json({ error: paymentFailure() }, { status: 500 });
  }
}
