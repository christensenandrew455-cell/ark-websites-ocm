import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import {
  BILLING_VERSION,
  ensureCustomerBillingSubscription,
  normalizeBillingPlan,
  reportBillableConversation,
} from "../../../lib/stripeUsageBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function recordId(clientId, conversationId) {
  return createHash("sha256").update(`${clientId}:${conversationId}`).digest("hex").slice(0, 48);
}

export async function POST(request) {
  const auth = await requireAuthenticatedCustomer(request);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const conversationId = text(body.conversationId || body.leadId);
    const leadId = text(body.leadId);
    if (!conversationId) {
      return NextResponse.json({ error: "A conversation or lead ID is required." }, { status: 400 });
    }

    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(auth.clientId);
    const accountRef = db.collection("accounts").doc(auth.decodedToken.uid);
    const [businessSnapshot, accountSnapshot] = await Promise.all([
      businessRef.get(),
      accountRef.get(),
    ]);
    if (!businessSnapshot.exists || !accountSnapshot.exists) {
      return NextResponse.json({ error: "This business account could not be found." }, { status: 404 });
    }

    const business = businessSnapshot.data();
    const account = accountSnapshot.data();
    const planKey = normalizeBillingPlan(account.billingPlan || business.billingPlan);
    if (planKey !== "solo_pro") {
      return NextResponse.json({ error: "Lead conversations are included with Solo Pro." }, { status: 403 });
    }

    const eventRef = db.collection("ocmClients").doc(auth.clientId).collection("billingConversationEvents").doc(recordId(auth.clientId, conversationId));
    const existing = await eventRef.get();
    if (existing.exists) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        conversationId,
        stripeReported: existing.data().stripeReported === true,
      });
    }

    const occurredAt = Number.isFinite(Date.parse(body.startedAt)) ? new Date(body.startedAt) : new Date();
    await eventRef.set({
      conversationId,
      leadId: leadId || null,
      startedAt: occurredAt,
      stripeReported: false,
      stripePricingVersion: BILLING_VERSION,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    let stripeReported = false;
    let stripeStatus = "not-synced";
    const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
    const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
    const acceptedCurrentTerms = account.termsAccepted === true;

    if (process.env.STRIPE_SECRET_KEY && customerId && paymentMethodId && acceptedCurrentTerms) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const subscription = await ensureCustomerBillingSubscription({
          stripe,
          db,
          clientId: auth.clientId,
          customerId,
          paymentMethodId,
          businessName: text(business.businessName || account.businessName || auth.clientId),
          uid: auth.decodedToken.uid,
          billingPlan: planKey,
          existingSubscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
        });
        await reportBillableConversation({
          stripe,
          customerId,
          clientId: auth.clientId,
          conversationId,
          occurredAt: occurredAt.getTime(),
        });
        stripeReported = true;
        stripeStatus = subscription.status;
        await eventRef.set({
          stripeReported: true,
          stripePricingVersion: BILLING_VERSION,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          reportedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (stripeError) {
        console.error("Unable to report conversation usage to Stripe", stripeError);
        stripeStatus = "sync-error";
      }
    }

    return NextResponse.json({
      ok: true,
      duplicate: false,
      conversationId,
      stripeReported,
      stripeStatus,
    });
  } catch (error) {
    console.error("Unable to record a new lead conversation", error);
    return NextResponse.json({ error: "Could not record the new conversation." }, { status: 500 });
  }
}
