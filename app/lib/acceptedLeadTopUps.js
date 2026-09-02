import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { acceptedLeadAccountPatch, acceptedLeadPlanStatus } from "./acceptedLeadPlanBilling.js";
import { sendAdminEvent } from "./adminEvents.js";
import { systemCollection } from "./firestoreLayout.js";

function text(value) {
  return String(value || "").trim();
}

function quantity(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 999_999 ? parsed : 0;
}

export function acceptedLeadTopUpDocumentId(provider, paymentId) {
  return createHash("sha256")
    .update(`${text(provider).toLowerCase()}:${text(paymentId)}`)
    .digest("hex")
    .slice(0, 48);
}

export async function grantAcceptedLeadTopUp({
  db,
  clientId,
  provider,
  paymentId,
  acceptedLeads,
  amountCents = 0,
  currency = "usd",
  purchasedAt = Date.now(),
}) {
  const safeClientId = text(clientId);
  const safeProvider = text(provider).toLowerCase();
  const safePaymentId = text(paymentId);
  const safeQuantity = quantity(acceptedLeads);
  if (!db || !safeClientId || !["stripe", "apple"].includes(safeProvider) || !safePaymentId || !safeQuantity) {
    throw new Error("ACCEPTED_LEAD_TOP_UP_INVALID");
  }

  const accountRef = db.collection("accounts").doc(safeClientId);
  const receiptRef = systemCollection(db, "acceptedLeadTopUpPayments")
    .doc(acceptedLeadTopUpDocumentId(safeProvider, safePaymentId));
  const settled = await db.runTransaction(async (transaction) => {
    const [accountSnapshot, receiptSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(receiptRef),
    ]);
    if (!accountSnapshot.exists) throw new Error("ACCOUNT_NOT_FOUND");
    const account = accountSnapshot.data();
    if (text(account.status) !== "active" || text(account.billingProvider || "stripe") !== safeProvider) {
      throw new Error("ACCEPTED_LEAD_TOP_UP_FORBIDDEN");
    }

    const current = acceptedLeadPlanStatus(account);
    if (receiptSnapshot.exists) {
      return { account, duplicate: true, status: current };
    }
    const next = acceptedLeadPlanStatus({
      ...account,
      acceptedLeadTopUpPeriodKey: current.periodKey,
      acceptedLeadTopUpsThisPeriod: current.acceptedLeadTopUps + safeQuantity,
    });
    const paidAt = Number.isFinite(Number(purchasedAt)) ? Number(purchasedAt) : Date.now();
    transaction.create(receiptRef, {
      provider: safeProvider,
      paymentId: safePaymentId,
      clientId: safeClientId,
      uid: text(account.uid),
      acceptedLeads: safeQuantity,
      amountCents: Math.max(0, Math.round(Number(amountCents) || 0)),
      currency: text(currency).toLowerCase() || "usd",
      acceptedLeadPeriodKey: next.periodKey,
      acceptedLeadPeriodEndAt: Timestamp.fromDate(new Date(next.periodEndAt)),
      purchasedAt: Timestamp.fromMillis(paidAt),
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(accountRef, {
      ...acceptedLeadAccountPatch(next),
      lastAcceptedLeadTopUpAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { account, duplicate: false, status: next };
  });

  if (!settled.duplicate) {
    await sendAdminEvent({
      id: `billing-paid-${safeProvider}-lead-top-up-${safePaymentId}`,
      type: "billing.payment_succeeded",
      clientId: safeClientId,
      businessName: text(settled.account.businessName || safeClientId),
      summary: `${safeQuantity} accepted-lead top-up succeeded`,
      metadata: {
        paymentId: safePaymentId,
        paymentKind: "accepted_lead_top_up",
        provider: safeProvider,
        acceptedLeads: safeQuantity,
        amountCents: Math.max(0, Math.round(Number(amountCents) || 0)),
        currency: text(currency).toLowerCase() || "usd",
        acceptedLeadPeriodKey: settled.status.periodKey,
      },
    });
  }

  return {
    duplicate: settled.duplicate,
    acceptedLeadsAdded: safeQuantity,
    acceptedLeadTopUps: settled.status.acceptedLeadTopUps,
    acceptedLeadPeriodLimit: settled.status.acceptedLeadPeriodLimit,
    acceptedLeadsUsed: settled.status.acceptedLeadsUsed,
    acceptedLeadsRemaining: settled.status.acceptedLeadsRemaining,
    periodEndAt: settled.status.periodEndAt,
  };
}
