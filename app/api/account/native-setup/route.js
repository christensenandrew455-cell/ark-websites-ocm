import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { customizationRootFieldDeletes, readAccountSections } from "../../../lib/accountSections";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["shown", "dismissed", "complete"]);

export async function POST(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;

  const status = String((await request.json().catch(() => ({})))?.status || "").trim().toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Choose shown, dismissed, or complete." }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(authorization.clientId);
    const accountSnapshot = await accountRef.get();
    if (!accountSnapshot.exists || String(accountSnapshot.data().uid || "") !== String(authorization.decodedToken.uid || "")) {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }

    const sections = await readAccountSections(accountSnapshot);
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(sections.customizationRef, {
      ...sections.customization,
      nativeSetupPromptStatus: status,
      ...(status === "shown" ? { nativeSetupPromptedAt: now } : { nativeSetupFinishedAt: now }),
      updatedAt: now,
    }, { merge: true });
    batch.update(accountRef, {
      ...customizationRootFieldDeletes(FieldValue.delete()),
      updatedAt: now,
    });
    await batch.commit();

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error("Unable to save native setup status", error);
    return NextResponse.json({ error: "Could not save phone setup status." }, { status: 500 });
  }
}
