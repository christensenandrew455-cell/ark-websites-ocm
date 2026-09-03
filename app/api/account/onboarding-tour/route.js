import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { customizationRootFieldDeletes, readAccountSections } from "../../../lib/accountSections";
import { requireUser } from "../../../lib/userRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

const PAGE_GUIDES = Object.freeze(["dashboard", "settings", "leads"]);
const PAGE_GUIDE_SET = new Set(PAGE_GUIDES);
const LEGACY_STATUSES = new Set(["started", "completed", "skipped"]);

function text(value) {
  return String(value || "").trim();
}

function guideSeen(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(PAGE_GUIDES.map((guide) => [guide, source[guide] === true]));
}

function normalizePhone(value) {
  const digits = text(value).replace(/^tel:/i, "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

export async function POST(request) {
  const authorization = await requireUser(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => ({}));
  const guide = text(body.guide).toLowerCase();
  const legacyStatus = text(body.status).toLowerCase();
  if (!PAGE_GUIDE_SET.has(guide) && guide !== "number-assigned" && !LEGACY_STATUSES.has(legacyStatus)) {
    return NextResponse.json({ error: "Choose a valid first-visit guide." }, { status: 400 });
  }

  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(authorization.clientId);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
  const sections = await readAccountSections(accountSnapshot);
  const now = FieldValue.serverTimestamp();
  let update;

  if (PAGE_GUIDE_SET.has(guide)) {
    const seen = { ...guideSeen(sections.customization.onboardingGuideSeen), [guide]: true };
    const completed = PAGE_GUIDES.every((key) => seen[key]);
    const status = completed ? "completed" : "started";
    update = {
      ...sections.customization,
      onboardingGuideVersion: 2,
      onboardingGuideSeen: seen,
      onboardingGuideUpdatedAt: now,
      onboardingTourStatus: status,
      ...(text(sections.customization.onboardingTourStatus) === "pending" ? { onboardingTourStartedAt: now } : {}),
      ...(completed ? { onboardingTourFinishedAt: now } : {}),
      updatedAt: now,
    };
  } else if (guide === "number-assigned") {
    const account = sections.combined;
    const assignedPhone = normalizePhone(account.receptionistPhoneNormalized || account.receptionistPhone);
    if (text(account.numberAssignmentStatus) !== "assigned" || !assignedPhone) {
      return NextResponse.json({ error: "Your receptionist number has not been assigned yet." }, { status: 409 });
    }
    update = {
      ...sections.customization,
      onboardingGuideVersion: 2,
      onboardingNumberGuidePhone: assignedPhone,
      onboardingNumberGuideSeenAt: now,
      updatedAt: now,
    };
  } else {
    update = {
      ...sections.customization,
      onboardingTourStatus: legacyStatus,
      updatedAt: now,
      ...(legacyStatus === "started" ? { onboardingTourStartedAt: now } : { onboardingTourFinishedAt: now }),
    };
  }

  const batch = db.batch();
  batch.set(sections.customizationRef, update, { merge: true });
  batch.update(accountRef, {
    ...customizationRootFieldDeletes(FieldValue.delete()),
    updatedAt: now,
  });
  await batch.commit();

  return NextResponse.json({
    ok: true,
    onboardingGuideVersion: Number(update.onboardingGuideVersion || sections.customization.onboardingGuideVersion || 0),
    onboardingGuideSeen: guideSeen(update.onboardingGuideSeen || sections.customization.onboardingGuideSeen),
    onboardingNumberGuidePhone: text(update.onboardingNumberGuidePhone || sections.customization.onboardingNumberGuidePhone),
    onboardingTourStatus: text(update.onboardingTourStatus || sections.customization.onboardingTourStatus),
  });
}
