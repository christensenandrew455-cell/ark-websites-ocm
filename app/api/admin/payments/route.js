import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { computeBillingState, publicBillingStatus } from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

function paymentPayload(document, now) {
  const business = document.data();
  const state = computeBillingState(business, now);
  return {
    clientId: document.id,
    businessName: text(business.businessName || document.id),
    ownerName: text(business.ownerName || business.accountEmail),
    accountEmail: text(business.accountEmail).toLowerCase(),
    ...publicBillingStatus(business, now),
    phase: state.phase,
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const now = Date.now();
    const snapshot = await getAdminDb().collection("businesses").where("billingPastDue", "==", true).get();
    const overdue = snapshot.docs
      .map((document) => paymentPayload(document, now))
      .filter((item) => item.showNotice)
      .sort((left, right) => new Date(left.failureAt || 0) - new Date(right.failureAt || 0));
    const retrying = overdue.filter((item) => item.phase === "payment_failed");
    const deletionDue = overdue.filter((item) => item.phase === "deletion_due");

    return NextResponse.json({
      generatedAt: new Date(now).toISOString(),
      overdue,
      retrying,
      deletionDue,
      counts: { overdue: overdue.length, retrying: retrying.length, deletionDue: deletionDue.length },
    });
  } catch (error) {
    console.error("Unable to load payment review", error);
    return NextResponse.json({ error: "Could not load payment accounts." }, { status: 500 });
  }
}
