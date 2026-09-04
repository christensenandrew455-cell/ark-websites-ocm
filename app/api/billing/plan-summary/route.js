import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireUser } from "../../../lib/userRequest";
import {
  acceptedLeadAccountPatch,
  acceptedLeadPlanStatus,
  countAcceptedClientsInPeriod,
  publicAcceptedLeadPlanSummary,
} from "../../../lib/acceptedLeadPlanBilling";
import { getAdminDb } from "../../../lib/firebase-admin";
import { stripeSubscriptionAccountFields } from "../../../lib/stripePlanBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function objectId(value) {
  return text(value?.id || value);
}

async function refreshStripeBillingAccount(accountRef, account) {
  const provider = text(account.billingProvider || (account.appleOriginalTransactionId ? "apple" : "stripe")).toLowerCase();
  const subscriptionId = text(account.stripeSubscriptionId);
  const stripeKey = text(process.env.STRIPE_SECRET_KEY);
  if (provider !== "stripe" || !subscriptionId || !stripeKey) return account;

  try {
    const stripe = new Stripe(stripeKey);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price", "items.data.price.product"],
    });
    const storedCustomerId = text(account.stripeCustomerId);
    if (storedCustomerId && objectId(subscription.customer) !== storedCustomerId) {
      throw new Error("STRIPE_SUBSCRIPTION_ACCOUNT_MISMATCH");
    }
    const synced = stripeSubscriptionAccountFields(subscription, account);
    await accountRef.set(synced.patch, { merge: true });
    const refreshed = await accountRef.get();
    return refreshed.exists ? refreshed.data() : account;
  } catch (error) {
    console.warn("Unable to refresh the Stripe billing period for plan summary", error);
    return account;
  }
}

export async function GET(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization.response;
  try {
    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(authorization.clientId);
    const snapshot = await accountRef.get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    const account = await refreshStripeBillingAccount(accountRef, snapshot.data());
    const storedStatus = acceptedLeadPlanStatus(account);
    const currentAcceptedClients = await countAcceptedClientsInPeriod(accountRef, storedStatus);
    const planSummary = publicAcceptedLeadPlanSummary(account, new Date(), currentAcceptedClients);
    if (planSummary.acceptedLeadsUsed > storedStatus.acceptedLeadsUsed) {
      await db.runTransaction(async (transaction) => {
        const freshSnapshot = await transaction.get(accountRef);
        if (!freshSnapshot.exists) return;
        const freshStatus = acceptedLeadPlanStatus(freshSnapshot.data());
        if (freshStatus.periodKey !== storedStatus.periodKey) return;
        const reconciled = acceptedLeadPlanStatus(freshSnapshot.data(), new Date(), currentAcceptedClients);
        if (reconciled.acceptedLeadsUsed > freshStatus.acceptedLeadsUsed) {
          transaction.set(accountRef, acceptedLeadAccountPatch(reconciled), { merge: true });
        }
      });
    }
    return NextResponse.json({
      billingProvider: String(account.billingProvider || (account.appleOriginalTransactionId ? "apple" : "stripe")),
      paymentMethodLabel: String(account.paymentMethodLabel || ""),
      pendingBillingPlanKey: String(account.pendingBillingPlanKey || ""),
      pendingBillingPlanName: String(account.pendingBillingPlanName || ""),
      pendingBillingPlanStartsAt: account.pendingBillingPlanStartsAt?.toDate?.()?.toISOString?.() || "",
      pendingBillingPlanTiming: String(account.pendingBillingPlanTiming || ""),
      ...planSummary,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to load monthly accepted-lead plan", error);
    return NextResponse.json({ error: "Could not load the current accepted-lead plan." }, { status: 500 });
  }
}
