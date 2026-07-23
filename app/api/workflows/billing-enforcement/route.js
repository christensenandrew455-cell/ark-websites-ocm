import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { computeBillingState } from "../../../lib/billingDelinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request) {
  const expected = String(process.env.BILLING_WORKFLOW_SECRET || process.env.OCM_REMINDER_SECRET || "").trim();
  const authorization = String(request.headers.get("authorization") || "");
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return Boolean(expected && provided && provided === expected);
}

export async function POST(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Workflow authorization failed." }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    const snapshot = await db.collection("businesses").where("billingPastDue", "==", true).get();
    const results = [];

    for (const document of snapshot.docs) {
      try {
        const business = document.data();
        const state = computeBillingState(business);
        const deletionReviewRequired = state.phase === "deletion-review";
        const changed = business.billingPhase !== state.phase
          || (business.serviceAccess || "full") !== state.serviceAccess
          || business.billingDeletionReviewRequired !== deletionReviewRequired;

        if (changed) {
          const patch = {
            billingPhase: state.phase,
            serviceAccess: state.serviceAccess,
            billingDeletionReviewRequired: deletionReviewRequired,
            updatedAt: FieldValue.serverTimestamp(),
          };
          const batch = db.batch();
          batch.set(document.ref, patch, { merge: true });
          if (business.uid) batch.set(db.collection("accounts").doc(String(business.uid)), patch, { merge: true });
          batch.set(db.collection("ocmClients").doc(document.id), patch, { merge: true });
          batch.set(
            db.collection("ocmClients").doc(document.id).collection("settings").doc("account"),
            {
              BillingStatus: state.phase,
              BillingPhase: state.phase,
              ServiceAccess: state.serviceAccess,
              BillingDeletionReviewRequired: deletionReviewRequired,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          await batch.commit();
        }

        results.push({ clientId: document.id, phase: state.phase, changed });
      } catch (error) {
        console.error(`Unable to enforce billing state for ${document.id}`, error);
        results.push({ clientId: document.id, error: error.message || "Unknown error" });
      }
    }

    return NextResponse.json({ ok: true, checked: snapshot.size, results });
  } catch (error) {
    console.error("Unable to run billing enforcement", error);
    return NextResponse.json({ error: "Billing enforcement failed." }, { status: 500 });
  }
}
