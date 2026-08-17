import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAuthenticatedCustomer } from "../../../lib/authenticatedRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export async function POST(request) {
  const authorization = await requireAuthenticatedCustomer(request);
  if (authorization.response) return authorization.response;
  const status = String((await request.json().catch(() => ({})))?.status || "").trim().toLowerCase();
  if (!new Set(["started", "completed", "skipped"]).has(status)) return NextResponse.json({ error: "Choose started, completed, or skipped." }, { status: 400 });
  const db = getAdminDb();
  const update = {
    onboardingTourStatus: status,
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === "started"
      ? { onboardingTourStartedAt: FieldValue.serverTimestamp() }
      : { onboardingTourFinishedAt: FieldValue.serverTimestamp() }),
  };
  await db.collection("accounts").doc(authorization.clientId).set(update, { merge: true });
  return NextResponse.json({ ok: true, status });
}
