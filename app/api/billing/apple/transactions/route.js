import { NextResponse } from "next/server";
import { APPLE_IAP_BASE_PRODUCT_ID, isAppleUsageProduct } from "../../../../lib/appleIapCatalog";
import { authorizeAppleBillingRequest, ensureAppleAppAccountToken, sameAppleAccountToken } from "../../../../lib/appleIapRequest";
import { settleAppleUsagePurchase, syncAppleSubscriptionTransaction } from "../../../../lib/appleIapTransactions";
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
      if (text(transaction.productId) !== APPLE_IAP_BASE_PRODUCT_ID) {
        return NextResponse.json({ error: "Complete the Apple monthly subscription first." }, { status: 409 });
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
    if (text(transaction.productId) === APPLE_IAP_BASE_PRODUCT_ID) {
      const result = await syncAppleSubscriptionTransaction({ db: access.db, clientId: access.clientId, transaction });
      if (!result.active) return NextResponse.json({ error: "This Apple subscription is not active." }, { status: 402 });
      return NextResponse.json({ status: "succeeded", kind: "subscription", ...result });
    }
    if (isAppleUsageProduct(transaction.productId)) {
      const result = await settleAppleUsagePurchase({
        db: access.db,
        clientId: access.clientId,
        uid: access.decoded.uid,
        transaction,
      });
      return NextResponse.json({ status: "succeeded", kind: "usage", transactionId: text(transaction.transactionId), ...result });
    }
    return NextResponse.json({ error: "This Apple product is not part of ARK billing." }, { status: 400 });
  } catch (error) {
    console.error("Unable to verify Apple transaction", error);
    const code = text(error?.message);
    const changed = code === "APPLE_USAGE_PRODUCT_CHANGED";
    return NextResponse.json({
      error: changed
        ? "Your referral price changed. Refresh and try the updated Apple purchase."
        : "Apple could not verify this purchase. Try Restore Purchases or contact support.",
      code,
    }, { status: changed ? 409 : 400 });
  }
}
