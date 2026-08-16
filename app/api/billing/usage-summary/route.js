import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import {
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CHAT_CENTS,
  PER_LEAD_CENTS,
  USAGE_CHARGE_THRESHOLD_POINTS,
  USAGE_POINT_CENTS,
} from "../../../lib/billingPricing";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export async function GET(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  try {
    const snapshot = await getAdminDb().collection("accounts").doc(authorization.decodedToken.uid).get();
    if (!snapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    const account = snapshot.data();
    const usageBalancePoints = Math.max(0, Math.floor(Number(account.usageBalancePoints || 0)));
    return NextResponse.json({
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      usageBalancePoints,
      usageBalanceCents: usageBalancePoints * USAGE_POINT_CENTS,
      usageThresholdPoints: USAGE_CHARGE_THRESHOLD_POINTS,
      usageThresholdCents: USAGE_CHARGE_THRESHOLD_POINTS * USAGE_POINT_CENTS,
      usageProgressPercent: Math.min(100, usageBalancePoints / USAGE_CHARGE_THRESHOLD_POINTS * 100),
      smsPartRemainder: Math.max(0, Math.floor(Number(account.usageSmsPartRemainder || 0))) % MESSAGE_PARTS_PER_BUNDLE,
      messagePartsPerPoint: MESSAGE_PARTS_PER_BUNDLE,
      leadPoints: PER_LEAD_CENTS / USAGE_POINT_CENTS,
      chatPoints: PER_CHAT_CENTS / USAGE_POINT_CENTS,
      usageChargeStatus: String(account.usageChargeStatus || "idle"),
      usageSuspended: account.usageSuspended === true,
      lastUsagePaymentAt: iso(account.lastUsagePaymentAt),
      lastPaymentAt: iso(account.lastPaymentAt),
    });
  } catch (error) {
    console.error("Unable to load usage balance", error);
    return NextResponse.json({ error: "Could not load the current usage balance." }, { status: 500 });
  }
}
