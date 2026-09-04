import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { customizationRootFieldDeletes, readAccountSections } from "../../../lib/accountSections";
import { requireUser } from "../../../lib/userRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

const QUICK_TUTORIAL_GUIDE = "quick-tutorial";
const GUIDE_VERSION = 3;

function text(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => ({}));
  if (text(body.guide).toLowerCase() !== QUICK_TUTORIAL_GUIDE) {
    return NextResponse.json({ error: "Choose a valid tutorial." }, { status: 400 });
  }

  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
  const sections = await readAccountSections(accountSnapshot);
  const now = FieldValue.serverTimestamp();
  const update = {
    ...sections.customization,
    onboardingTourStatus: "completed",
    onboardingGuideVersion: GUIDE_VERSION,
    onboardingTourStartedAt: sections.customization.onboardingTourStartedAt || now,
    onboardingTourFinishedAt: now,
    onboardingGuideSeen: FieldValue.delete(),
    onboardingGuideUpdatedAt: FieldValue.delete(),
    onboardingNumberGuidePhone: FieldValue.delete(),
    onboardingNumberGuideSeenAt: FieldValue.delete(),
    updatedAt: now,
  };

  const batch = db.batch();
  batch.set(sections.customizationRef, update, { merge: true });
  batch.update(accountRef, {
    ...customizationRootFieldDeletes(FieldValue.delete()),
    updatedAt: now,
  });
  await batch.commit();

  return NextResponse.json({
    ok: true,
    onboardingGuideVersion: GUIDE_VERSION,
    onboardingTourStatus: "completed",
  });
}
