import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { syncBillingState } from "../../../../lib/billingDelinquency";

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
        const state = await syncBillingState(db, document.id, document.data());
        results.push({ clientId: document.id, phase: state.phase, changed: state.changed });
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
