import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";
import { asMillis, computeBillingState, publicBillingStatus } from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  const milliseconds = asMillis(value);
  return milliseconds ? new Date(milliseconds).toISOString() : "";
}

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
    restricted: state.restricted,
    showNotice: state.showNotice,
    snoozedUntil: iso(business.billingReviewSnoozedUntil),
  };
}

async function writePaymentPatch(db, clientId, business, patch, settingsPatch = {}) {
  const batch = db.batch();
  batch.set(db.collection("businesses").doc(clientId), patch, { merge: true });
  if (business.uid) batch.set(db.collection("accounts").doc(text(business.uid)), patch, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), patch, { merge: true });
  batch.set(
    db.collection("ocmClients").doc(clientId).collection("settings").doc("account"),
    {
      ...settingsPatch,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const db = getAdminDb();
    const snapshot = await db.collection("businesses").where("billingPastDue", "==", true).get();
    const now = Date.now();
    const overdue = snapshot.docs
      .map((document) => paymentPayload(document, now))
      .filter((item) => item.showNotice)
      .sort((a, b) => new Date(a.failureAt || 0) - new Date(b.failureAt || 0));

    const grace = overdue.filter((item) => item.phase === "grace");
    const disabled = overdue.filter((item) => item.phase === "restricted");
    const ready = overdue.filter((item) => item.phase === "deletion-review" && new Date(item.snoozedUntil || 0).getTime() <= now);
    const snoozed = overdue.filter((item) => item.phase === "deletion-review" && new Date(item.snoozedUntil || 0).getTime() > now);

    return NextResponse.json({
      generatedAt: new Date(now).toISOString(),
      overdue,
      grace,
      disabled,
      ready,
      snoozed,
      counts: {
        overdue: overdue.length,
        grace: grace.length,
        disabled: disabled.length,
        ready: ready.length,
      },
    });
  } catch (error) {
    console.error("Unable to load payment review", error);
    return NextResponse.json({ error: "Could not load payment accounts." }, { status: 500 });
  }
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const body = await request.json();
    const clientId = text(body.clientId);
    const action = text(body.action);
    if (!clientId) return NextResponse.json({ error: "Choose a customer account." }, { status: 400 });

    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(clientId);
    const snapshot = await businessRef.get();
    if (!snapshot.exists) return NextResponse.json({ error: "That customer account no longer exists." }, { status: 404 });

    const business = snapshot.data();
    if (business.billingPastDue !== true) {
      return NextResponse.json({ error: "That account is no longer overdue." }, { status: 409 });
    }

    if (action === "snooze") {
      const snoozedUntil = Timestamp.fromMillis(Date.now() + DAY_MS);
      const patch = {
        billingReviewSnoozedUntil: snoozedUntil,
        billingReviewSnoozedBy: admin.decodedToken.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      await writePaymentPatch(db, clientId, business, patch, {
        BillingReviewSnoozedUntil: snoozedUntil,
      });
      return NextResponse.json({ ok: true, action, snoozedUntil: snoozedUntil.toDate().toISOString() });
    }

    if (action === "restore") {
      const now = Date.now();
      const graceEndsAt = Timestamp.fromMillis(now + 7 * DAY_MS);
      const reviewAt = Timestamp.fromMillis(now + 14 * DAY_MS);
      const patch = {
        billingPhase: "grace",
        serviceAccess: "full",
        billingDeletionReviewRequired: false,
        billingGraceEndsAt: graceEndsAt,
        billingAdminGraceEndsAt: graceEndsAt,
        billingDeletionReviewAt: reviewAt,
        billingReviewSnoozedUntil: FieldValue.delete(),
        billingReviewSnoozedBy: FieldValue.delete(),
        billingRestoredBy: admin.decodedToken.uid,
        billingRestoredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await writePaymentPatch(db, clientId, business, patch, {
        BillingStatus: "grace",
        BillingPhase: "grace",
        ServiceAccess: "full",
        BillingDeletionReviewRequired: false,
        BillingGraceEndsAt: graceEndsAt,
        BillingAdminGraceEndsAt: graceEndsAt,
        BillingDeletionReviewAt: reviewAt,
        BillingReviewSnoozedUntil: FieldValue.delete(),
      });
      return NextResponse.json({ ok: true, action, graceEndsAt: graceEndsAt.toDate().toISOString() });
    }

    return NextResponse.json({ error: "Choose Restore or Ask Again in 24 Hours." }, { status: 400 });
  } catch (error) {
    console.error("Unable to update payment review", error);
    return NextResponse.json({ error: error.message || "Could not update the payment account." }, { status: 500 });
  }
}
