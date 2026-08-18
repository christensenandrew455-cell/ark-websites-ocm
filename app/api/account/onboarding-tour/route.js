import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { customizationRootFieldDeletes, readAccountSections } from "../../../lib/accountSections";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export async function POST(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  const status = String((await request.json().catch(() => ({})))?.status || "").trim().toLowerCase();
  if (!new Set(["started", "completed", "skipped"]).has(status)) return NextResponse.json({ error: "Choose started, completed, or skipped." }, { status: 400 });
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
  const sections = await readAccountSections(accountSnapshot);
  const update = {
    ...sections.customization,
    onboardingTourStatus: status,
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === "started"
      ? { onboardingTourStartedAt: FieldValue.serverTimestamp() }
      : { onboardingTourFinishedAt: FieldValue.serverTimestamp() }),
  };
  const batch = db.batch();
  batch.set(sections.customizationRef, update, { merge: true });
  batch.update(accountRef, {
    ...customizationRootFieldDeletes(FieldValue.delete()),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return NextResponse.json({ ok: true, status });
}
