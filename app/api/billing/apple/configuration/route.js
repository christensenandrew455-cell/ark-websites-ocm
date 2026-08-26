import { NextResponse } from "next/server";
import { appleIapCatalog, appleUsageProduct, isAppleUsageProduct } from "../../../../lib/appleIapCatalog";
import { authorizeAppleBillingRequest, ensureAppleAppAccountToken } from "../../../../lib/appleIapRequest";
import { activeReferralSavings } from "../../../../lib/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function configuration(request) {
  const access = await authorizeAppleBillingRequest(request);
  if (access.response) return access.response;
  try {
    const appAccountToken = await ensureAppleAppAccountToken(access);
    const catalog = appleIapCatalog();
    const referral = access.kind === "active"
      ? await activeReferralSavings({ db: access.db, clientId: access.clientId })
      : { count: 0, percent: 0 };
    const calculatedUsage = appleUsageProduct(referral.percent);
    const storedProductId = String(access.account?.usageChargeAppleProductId || "").trim();
    const usage = access.kind === "active"
      && String(access.account.usageChargeStatus || "") === "purchase_required"
      && isAppleUsageProduct(storedProductId)
      ? {
        productId: storedProductId,
        discountPercent: Number(access.account.usageChargeReferralDiscountPercent || 0),
        amountCents: Number(access.account.usageChargeAmountCents || calculatedUsage.amountCents),
      }
      : calculatedUsage;
    return NextResponse.json({
      mode: access.kind === "pending" ? "signup" : "account",
      billingProvider: access.kind === "active" ? String(access.account.billingProvider || "") : "apple",
      appAccountToken,
      baseProduct: catalog.base,
      usageProduct: usage,
      productIds: [catalog.base.productId, ...catalog.usage.map((item) => item.productId)],
      referralDiscountPercent: usage.discountPercent,
      activeReferralCount: Number(referral.count || 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to prepare Apple billing configuration", error);
    return NextResponse.json({ error: "Apple billing is not configured for this account." }, { status: 409 });
  }
}

export async function GET(request) { return configuration(request); }
export async function POST(request) { return configuration(request); }
