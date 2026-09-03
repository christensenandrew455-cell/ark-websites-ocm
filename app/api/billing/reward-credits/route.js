import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import { redeemRewardLeadCredits } from "../../../lib/rewardLeadCredits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function redemptionError(error) {
  const message = text(error?.message);
  if (message === "REWARD_REDEMPTION_LIMIT_NOT_REACHED") return { status: 409, error: "Free lead credits become available after you use all included leads for this billing period." };
  if (message === "REWARD_REDEMPTION_BALANCE_LOW") return { status: 409, error: "At least five banked free lead credits are required." };
  if (message === "REWARD_REDEMPTION_PAYMENT_REQUIRED") return { status: 409, error: "Update the subscription payment before applying free lead credits." };
  if (message === "REWARD_REDEMPTION_FORBIDDEN") return { status: 403, error: "An active owner account is required." };
  if (message === "REWARD_REDEMPTION_INVALID") return { status: 400, error: "A valid redemption request is required." };
  return { status: 500, error: "Free lead credits could not be applied right now." };
}

export async function POST(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  try {
    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({
      db,
      request,
      scope: `reward-credit-redemption:${authorization.clientId}`,
      limit: 12,
      windowMs: 60 * 60 * 1000,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    const body = await request.json().catch(() => ({}));
    const result = await redeemRewardLeadCredits({
      db,
      clientId: authorization.clientId,
      requestId: body.requestId,
    });
    return NextResponse.json({
      ok: true,
      acceptedLeadsAdded: Number(result.acceptedLeadsAdded || 0),
      rewardLeadCreditBalance: Number(result.balanceAfter || 0),
      idempotent: result.idempotent === true,
    });
  } catch (error) {
    console.error("Unable to redeem free lead credits", error);
    const response = redemptionError(error);
    return NextResponse.json({ error: response.error }, { status: response.status });
  }
}
