import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import {
  acceptedLeadAccountPatch,
  acceptedLeadPlanStatus,
  countAcceptedClientsInPeriod,
  publicAcceptedLeadPlanSummary,
} from "../../../lib/acceptedLeadPlanBilling";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  try {
    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(authorization.clientId);
    const snapshot = await accountRef.get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    const account = snapshot.data();
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
      rewardLeadCreditBalance: Math.max(0, Math.floor(Number(account.rewardLeadCreditBalance || 0))),
      ...planSummary,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to load monthly accepted-lead plan", error);
    return NextResponse.json({ error: "Could not load the current accepted-lead plan." }, { status: 500 });
  }
}
