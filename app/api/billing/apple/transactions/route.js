import { NextResponse } from "next/server";
import { grantAcceptedLeadTopUp } from "../../../../lib/acceptedLeadTopUps";
import { isAppleAcceptedLeadTopUpProduct, isApplePlanProduct } from "../../../../lib/appleIapCatalog";
import { authorizeAppleBillingRequest, ensureAppleAppAccountToken, sameAppleAccountToken } from "../../../../lib/appleIapRequest";
import { syncAppleSubscriptionTransaction } from "../../../../lib/appleIapTransactions";
import { verifySignedAppleTransaction } from "../../../../lib/appleIapVerification";
import { completeOwnerApplePaymentSetup } from "../../../../lib/ownerApplePaymentSetup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

export async function POST(request) {
  const access = await authorizeAppleBillingRequest(request);
  if (access.response) return access.response;
  try {
    const body = await request.json().catch(() => ({}));
    const signedTransaction = text(body.signedTransaction);
    if (!signedTransaction || signedTransaction.length > 32_000) {
      return NextResponse.json({ error: "The Apple transaction is missing." }, { status: 400 });
    }
    const verified = await verifySignedAppleTransaction(signedTransaction);
    const transaction = { ...verified.transaction, environment: verified.environment };
    const appAccountToken = await ensureAppleAppAccountToken(access);
    if (!sameAppleAccountToken(appAccountToken, transaction.appAccountToken)) {
      return NextResponse.json({ error: "This Apple purchase belongs to a different account." }, { status: 403 });
    }

    if (access.kind === "pending") {
      if (!isApplePlanProduct(transaction.productId)) {
        return NextResponse.json({ error: "Choose an ARK monthly accepted-lead plan first." }, { status: 409 });
      }
      const result = await completeOwnerApplePaymentSetup({
        db: access.db,
        auth: access.auth,
        uid: access.decoded.uid,
        transaction,
      });
      return NextResponse.json({ status: result.status, kind: "subscription", transactionId: text(transaction.transactionId), nextPath: result.nextPath });
    }

    if (access.account.billingProvider !== "apple") {
      return NextResponse.json({ error: "This account uses Stripe billing." }, { status: 409 });
    }
    if (isApplePlanProduct(transaction.productId)) {
      const result = await syncAppleSubscriptionTransaction({ db: access.db, clientId: access.clientId, transaction });
      if (!result.active) return NextResponse.json({ error: "This Apple subscription is not active." }, { status: 402 });
      return NextResponse.json({ status: "succeeded", kind: "subscription", ...result });
    }
    if (isAppleAcceptedLeadTopUpProduct(transaction.productId)) {
      const acceptedLeads = Math.max(0, Math.floor(Number(transaction.quantity || 0)));
      if (!acceptedLeads) return NextResponse.json({ error: "Apple did not include the number of added leads." }, { status: 400 });
      const unitAmountCents = Number(transaction.price || 0) > 0
        ? Math.round(Number(transaction.price) / 10)
        : 100;
      const result = await grantAcceptedLeadTopUp({
        db: access.db,
        clientId: access.clientId,
        provider: "apple",
        paymentId: text(transaction.transactionId),
        acceptedLeads,
        amountCents: unitAmountCents * acceptedLeads,
        currency: text(transaction.currency || "usd").toLowerCase(),
        purchasedAt: Number(transaction.purchaseDate || 0) || Date.now(),
      });
      return NextResponse.json({ status: "succeeded", kind: "accepted_lead_top_up", ...result });
    }
    return NextResponse.json({ error: "This Apple product is not part of ARK billing." }, { status: 400 });
  } catch (error) {
    console.error("Unable to verify Apple transaction", error);
    const code = text(error?.message);
    return NextResponse.json({
      error: "Apple could not verify this purchase. Try Restore Purchases or contact support.",
      code,
    }, { status: 400 });
  }
}
