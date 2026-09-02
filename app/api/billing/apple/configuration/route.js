import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { appleIapCatalog, applePlanProduct } from "../../../../lib/appleIapCatalog";
import { authorizeAppleBillingRequest, ensureAppleAppAccountToken } from "../../../../lib/appleIapRequest";
import { normalizeBillingPlanKey } from "../../../../lib/billingPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function configuration(request, requestedPlanKey = "") {
  const access = await authorizeAppleBillingRequest(request);
  if (access.response) return access.response;
  try {
    const appAccountToken = await ensureAppleAppAccountToken(access);
    const catalog = appleIapCatalog();
    const storedPlanKey = access.kind === "pending"
      ? access.pending.data.payment?.billingPlanKey
      : access.account?.billingPlanKey;
    const planKey = normalizeBillingPlanKey(requestedPlanKey || storedPlanKey);
    const selectedPlan = applePlanProduct(planKey);
    if (access.kind === "pending") {
      const payment = access.pending.data.payment || {};
      await access.pending.ref.set({
        payment: { ...payment, billingPlanKey: planKey, appleStatus: "ready" },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      access.pending.data.payment = { ...payment, billingPlanKey: planKey, appleStatus: "ready" };
    }
    return NextResponse.json({
      mode: access.kind === "pending" ? "signup" : "account",
      billingProvider: access.kind === "active" ? String(access.account.billingProvider || "") : "apple",
      appAccountToken,
      selectedPlan,
      plans: catalog.plans,
      acceptedLeadTopUp: catalog.acceptedLeadTopUp,
      productIds: [...catalog.plans.map((plan) => plan.productId), catalog.acceptedLeadTopUp.productId],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to prepare Apple billing configuration", error);
    return NextResponse.json({ error: "Apple billing is not configured for this account." }, { status: 409 });
  }
}

export async function GET(request) { return configuration(request); }
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  return configuration(request, body.planKey);
}
