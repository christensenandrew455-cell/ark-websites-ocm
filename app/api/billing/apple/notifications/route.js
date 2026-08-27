import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { NotificationTypeV2, Status } from "@apple/app-store-server-library";
import { isApplePlanProduct } from "../../../../lib/appleIapCatalog";
import { syncAppleSubscriptionTransaction } from "../../../../lib/appleIapTransactions";
import { verifySignedAppleNotification } from "../../../../lib/appleIapVerification";
import { registerPaymentFailure } from "../../../../lib/billingDelinquency";
import { getAdminDb } from "../../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

async function accountForAppleSubscription(db, transaction, renewal) {
  const originalTransactionId = text(transaction?.originalTransactionId || renewal?.originalTransactionId);
  if (originalTransactionId) {
    const match = await db.collection("accounts").where("appleOriginalTransactionId", "==", originalTransactionId).limit(1).get();
    if (!match.empty) return match.docs[0];
  }
  const appAccountToken = text(transaction?.appAccountToken).toLowerCase();
  if (appAccountToken) {
    const match = await db.collection("accounts").where("appleAppAccountToken", "==", appAccountToken).limit(1).get();
    if (!match.empty) return match.docs[0];
  }
  return null;
}

export async function POST(request) {
  try {
    const { signedPayload } = await request.json().catch(() => ({}));
    if (!text(signedPayload) || text(signedPayload).length > 64_000) {
      return NextResponse.json({ error: "Apple notification payload is missing." }, { status: 400 });
    }
    const { environment, notification, verifier } = await verifySignedAppleNotification(signedPayload);
    const notificationType = text(notification.notificationType);
    const notificationId = text(notification.notificationUUID || `${notificationType}-${notification.signedDate || Date.now()}`);
    if (notificationType === NotificationTypeV2.TEST) return NextResponse.json({ received: true, test: true });

    const [transaction, renewal] = await Promise.all([
      notification.data?.signedTransactionInfo
        ? verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo)
        : null,
      notification.data?.signedRenewalInfo
        ? verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo)
        : null,
    ]);
    const productId = text(transaction?.productId || renewal?.productId);
    if (productId && !isApplePlanProduct(productId)) {
      return NextResponse.json({ received: true, ignored: true, reason: "non-subscription-product" });
    }
    const db = getAdminDb();
    const accountDocument = await accountForAppleSubscription(db, transaction, renewal);
    if (!accountDocument) return NextResponse.json({ received: true, ignored: true, reason: "account-not-found" });
    const account = accountDocument.data();
    if (account.billingProvider !== "apple") return NextResponse.json({ received: true, ignored: true, reason: "non-apple-account" });

    const status = Number(notification.data?.status || 0);
    const transactionWithEnvironment = transaction ? { ...transaction, environment } : null;
    const activeOrGrace = status === Status.ACTIVE || status === Status.BILLING_GRACE_PERIOD;
    if (transactionWithEnvironment && (activeOrGrace
      || [NotificationTypeV2.SUBSCRIBED, NotificationTypeV2.DID_RENEW, NotificationTypeV2.REFUND_REVERSED].includes(notificationType))) {
      await syncAppleSubscriptionTransaction({
        db,
        clientId: accountDocument.id,
        transaction: transactionWithEnvironment,
        eventId: notificationId,
      });
    }

    await accountDocument.ref.set({
      appleAutoRenewEnabled: Number(renewal?.autoRenewStatus || 0) === 1,
      appleSubscriptionStatus: activeOrGrace ? status === Status.BILLING_GRACE_PERIOD ? "grace_period" : "active"
        : status === Status.BILLING_RETRY ? "billing_retry"
          : status === Status.REVOKED ? "revoked"
            : status === Status.EXPIRED ? "expired" : text(account.appleSubscriptionStatus || "unknown"),
      ...(Number(renewal?.gracePeriodExpiresDate || 0) ? { appleGracePeriodExpiresAt: Timestamp.fromMillis(Number(renewal.gracePeriodExpiresDate)) } : { appleGracePeriodExpiresAt: FieldValue.delete() }),
      appleLastNotificationType: notificationType,
      appleLastNotificationId: notificationId,
      appleLastNotificationAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const paymentFailed = status === Status.BILLING_RETRY
      || status === Status.EXPIRED
      || status === Status.REVOKED
      || [NotificationTypeV2.EXPIRED, NotificationTypeV2.GRACE_PERIOD_EXPIRED, NotificationTypeV2.REVOKE].includes(notificationType)
      || (notificationType === NotificationTypeV2.DID_FAIL_TO_RENEW && status !== Status.BILLING_GRACE_PERIOD)
      || (notificationType === NotificationTypeV2.REFUND && text(transaction?.type) === "Auto-Renewable Subscription");
    if (paymentFailed) {
      await registerPaymentFailure({
        db,
        clientId: accountDocument.id,
        eventId: notificationId,
        invoiceId: text(transaction?.transactionId || renewal?.originalTransactionId),
        failedAt: Number(notification.signedDate || Date.now()),
        provider: "apple",
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Unable to process Apple billing notification", error);
    return NextResponse.json({ error: "Apple notification verification failed." }, { status: 400 });
  }
}
