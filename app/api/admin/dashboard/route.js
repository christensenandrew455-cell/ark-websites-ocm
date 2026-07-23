import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { computeBillingState, publicBillingStatus } from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function timestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return representedAsUtc - date.getTime();
}

function periodStartSeconds(timeZone, monthStart = false) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const approximate = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    monthStart ? 1 : Number(values.day),
    0,
    0,
    0
  ));
  return Math.floor((approximate.getTime() - zoneOffsetMs(approximate, timeZone)) / 1000);
}

function addAmount(map, currency, amount) {
  const key = text(currency || "usd").toLowerCase();
  map.set(key, Number(map.get(key) || 0) + Math.max(0, Number(amount || 0)));
}

function primaryTotals(map) {
  const entries = [...map.entries()].map(([currency, amount]) => ({ currency, amount }));
  const primary = entries.find((item) => item.currency === "usd") || entries[0] || { currency: "usd", amount: 0 };
  return { ...primary, currencies: entries };
}

async function stripePaymentData(businesses) {
  const stripeKey = text(process.env.STRIPE_SECRET_KEY);
  if (!stripeKey) return { configured: false, liveOnly: true, totals: {}, recentPayments: [] };

  const stripe = new Stripe(stripeKey);
  const timeZone = text(process.env.ADMIN_TIME_ZONE || "America/New_York");
  const todayStart = periodStartSeconds(timeZone, false);
  const monthStart = periodStartSeconds(timeZone, true);
  const today = new Map();
  const month = new Map();
  const all = new Map();
  const recentPayments = [];
  const businessByCustomer = new Map(
    businesses
      .filter((item) => text(item.stripeCustomerId))
      .map((item) => [text(item.stripeCustomerId), item])
  );

  let startingAfter;
  let pages = 0;
  let hasMore = true;
  while (hasMore && pages < 100) {
    const response = await stripe.charges.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    pages += 1;

    for (const charge of response.data) {
      if (!charge.livemode || !charge.paid || charge.status !== "succeeded" || Number(charge.amount_captured || 0) <= 0) continue;
      const netAmount = Math.max(0, Number(charge.amount_captured || 0) - Number(charge.amount_refunded || 0));
      addAmount(all, charge.currency, netAmount);
      if (charge.created >= monthStart) addAmount(month, charge.currency, netAmount);
      if (charge.created >= todayStart) addAmount(today, charge.currency, netAmount);

      if (recentPayments.length < 20) {
        const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id || "";
        const business = businessByCustomer.get(customerId);
        recentPayments.push({
          id: charge.id,
          clientId: business?.clientId || text(charge.metadata?.clientId),
          businessName: business?.businessName || text(charge.billing_details?.name || charge.description || customerId || "Stripe customer"),
          amount: netAmount,
          currency: text(charge.currency || "usd").toLowerCase(),
          paidAt: new Date(charge.created * 1000).toISOString(),
        });
      }
    }

    hasMore = response.has_more;
    startingAfter = response.data.at(-1)?.id;
    if (!startingAfter) break;
  }

  return {
    configured: true,
    liveOnly: true,
    truncated: hasMore,
    timeZone,
    totals: {
      today: primaryTotals(today),
      month: primaryTotals(month),
      all: primaryTotals(all),
    },
    recentPayments,
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const db = getAdminDb();
    const [requestSnapshot, accountSnapshot, businessSnapshot] = await Promise.all([
      db.collection("supportRequests").get(),
      db.collection("accounts").get(),
      db.collection("businesses").get(),
    ]);

    const businesses = businessSnapshot.docs.map((document) => ({
      clientId: document.id,
      ...document.data(),
    }));

    const openRequests = requestSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((item) => item.status === "new" || item.status === "in-progress")
      .map((item) => ({
        id: item.id,
        clientId: text(item.clientId),
        businessName: text(item.businessName || item.clientId),
        ownerName: text(item.ownerName || item.accountEmail),
        type: item.type === "help" ? "help" : "change",
        subject: text(item.subject),
        message: text(item.message),
        status: text(item.status || "new"),
        createdAt: iso(item.createdAt),
      }))
      .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));

    const pendingAccounts = accountSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((item) => item.status === "pending_verification" || item.status === "approved_pending_payment")
      .map((item) => ({
        uid: item.id,
        clientId: text(item.clientId),
        businessName: text(item.businessName || item.clientId),
        ownerName: text(item.ownerName),
        accountEmail: text(item.accountEmail).toLowerCase(),
        status: text(item.status),
        createdAt: iso(item.createdAt),
      }))
      .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));

    const paymentIssues = businesses
      .filter((business) => business.billingPastDue === true)
      .map((business) => {
        const state = computeBillingState(business);
        return {
          clientId: business.clientId,
          businessName: text(business.businessName || business.clientId),
          ownerName: text(business.ownerName || business.accountEmail),
          accountEmail: text(business.accountEmail).toLowerCase(),
          ...publicBillingStatus(business),
          phase: state.phase,
          restricted: state.restricted,
          showNotice: state.showNotice,
        };
      })
      .filter((item) => item.showNotice)
      .sort((a, b) => timestamp(a.failureAt) - timestamp(b.failureAt));

    const stripe = await stripePaymentData(businesses).catch((error) => {
      console.error("Unable to load Stripe dashboard totals", error);
      return { configured: true, liveOnly: true, error: "Stripe totals are temporarily unavailable.", totals: {}, recentPayments: [] };
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      openRequests,
      pendingAccounts,
      paymentIssues,
      deletionReview: paymentIssues.filter((item) => item.phase === "deletion-review"),
      stripe,
      counts: {
        customers: businesses.length,
        openRequests: openRequests.length,
        pendingAccounts: pendingAccounts.length,
        needsPayment: paymentIssues.length,
        deletionReview: paymentIssues.filter((item) => item.phase === "deletion-review").length,
      },
    });
  } catch (error) {
    console.error("Unable to load administrator attention dashboard", error);
    return NextResponse.json({ error: "Could not load the administrator dashboard." }, { status: 500 });
  }
}
