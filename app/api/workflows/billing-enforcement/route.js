import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { asMillis, computeBillingState, PAYMENT_RETRY_INTERVAL_MS, resolvePayment } from "../../../lib/billingDelinquency";
import { deleteCustomerPermanently } from "../../../lib/customerLifecycle";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) { return String(value || "").trim(); }
function authorized(request) {
  const expected = text(process.env.CRON_SECRET);
  const authorization = text(request.headers.get("authorization"));
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

async function scheduleNextRetry(db, document, business, now, error) {
  const nextRetryAt = Timestamp.fromMillis(now + PAYMENT_RETRY_INTERVAL_MS);
  const patch = {
    billingPhase: "payment_failed",
    serviceAccess: "payment-update-only",
    billingNextRetryAt: nextRetryAt,
    billingLastRetryAt: FieldValue.serverTimestamp(),
    billingRetryCount: FieldValue.increment(1),
    billingLastRetryError: text(error?.code || error?.message).slice(0, 200),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(document.ref, patch, { merge: true });
  const uid = text(business.uid || business.ownerUid);
  if (uid) batch.set(db.collection("accounts").doc(uid), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(document.id), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(document.id).collection("settings").doc("account"), { BillingNextRetryAt: nextRetryAt, BillingLastRetryAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}

async function runEnforcement(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Workflow authorization failed." }, { status: 401 });
  try {
    const db = getAdminDb();
    const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
    const snapshot = await db.collection("businesses").where("billingPastDue", "==", true).get();
    const results = [];
    const now = Date.now();

    for (const document of snapshot.docs) {
      try {
        const business = document.data();
        const state = computeBillingState(business, now);
        if (state.phase === "deletion_due") {
          await deleteCustomerPermanently(document.id);
          results.push({ clientId: document.id, status: "deleted_after_seven_days" });
          continue;
        }

        const invoiceId = text(business.billingInvoiceId);
        const retryAt = asMillis(business.billingNextRetryAt);
        if (stripe && invoiceId.startsWith("in_") && (!retryAt || retryAt <= now)) {
          try {
            const invoice = await stripe.invoices.pay(invoiceId);
            if (invoice.paid || invoice.status === "paid") {
              await resolvePayment({ db, clientId: document.id, eventId: `invoice-retry-resolved-${invoice.id}-${now}`, invoiceId: invoice.id });
              results.push({ clientId: document.id, status: "paid_and_restored" });
              continue;
            }
            throw new Error(`INVOICE_${text(invoice.status).toUpperCase()}`);
          } catch (error) {
            await scheduleNextRetry(db, document, business, now, error);
            results.push({ clientId: document.id, status: "retry_failed", nextRetryAt: new Date(now + PAYMENT_RETRY_INTERVAL_MS).toISOString() });
            continue;
          }
        }

        results.push({ clientId: document.id, status: "waiting_for_retry", nextRetryAt: state.retryAt ? new Date(state.retryAt).toISOString() : "" });
      } catch (error) {
        console.error(`Unable to enforce billing state for ${document.id}`, error);
        results.push({ clientId: document.id, status: "error", error: text(error?.message) || "Unknown error" });
      }
    }
    return NextResponse.json({ ok: true, checked: snapshot.size, results });
  } catch (error) {
    console.error("Unable to run billing enforcement", error);
    return NextResponse.json({ error: "Billing enforcement failed." }, { status: 500 });
  }
}

export async function GET(request) { return runEnforcement(request); }
export async function POST(request) { return runEnforcement(request); }
