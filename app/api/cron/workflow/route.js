import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../lib/firebase-admin";
import { businessNow, isDateDue } from "../../../lib/businessTime";
import { sendEstimateRequestStatusNotice } from "../../../lib/estimateRequestStatusNotice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_CLIENT_ID = "tabor-painting";
const ESTIMATE_REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

function missingFirebaseAdminVariables() {
  return [
    ["FIREBASE_PROJECT_ID", process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID],
    ["FIREBASE_CLIENT_EMAIL", process.env.FIREBASE_CLIENT_EMAIL],
    ["FIREBASE_PRIVATE_KEY", process.env.FIREBASE_PRIVATE_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
}

function safeWorkflowError(error) {
  const message = String(error?.message || "");
  if (/private key|pem|credential|firebase admin/i.test(message)) {
    return "Firebase Admin credentials are invalid. Check FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel, then redeploy.";
  }
  return "Workflow check failed. Review the Vercel function logs for /api/cron/workflow.";
}

async function listActiveBusinesses(db) {
  const snapshot = await db.collection("businesses").where("status", "==", "active").get();
  const businesses = new Map(snapshot.docs.map((documentSnapshot) => [documentSnapshot.id, documentSnapshot.data()]));
  if (!businesses.has(LEGACY_CLIENT_ID)) {
    const legacy = await db.collection("businesses").doc(LEGACY_CLIENT_ID).get();
    if (legacy.exists) businesses.set(LEGACY_CLIENT_ID, legacy.data());
  }
  return businesses;
}

async function autoDeclineExpiredEstimateRequests(db, clientId, business, now) {
  const contactedRef = db.collection("ocmClients").doc(clientId).collection("contactedMe");
  const snapshot = await contactedRef.get();
  let autoDeclined = 0;
  let declineNoticesFailed = 0;

  for (const documentSnapshot of snapshot.docs) {
    const lead = documentSnapshot.data();
    const createdAt = toMillis(lead.createdAt || lead.contactedAt || lead.updatedAt);
    if (!createdAt || now.getTime() - createdAt < ESTIMATE_REQUEST_LIFETIME_MS) continue;

    if (business?.clientDeclineNoticeEnabled !== false) {
      const notice = await sendEstimateRequestStatusNotice({
        db,
        clientId,
        businessName: text(business?.businessName || business?.name) || "the business",
        leadId: documentSnapshot.id,
        leadName: text(lead.Name || lead.name || lead.fullName),
        phone: text(lead.Phone || lead.phone || lead.phoneNumber),
        status: "declined",
      });
      if (notice.sent === false && !notice.skipped && !notice.duplicate) declineNoticesFailed += 1;
    }

    await documentSnapshot.ref.delete();
    autoDeclined += 1;
  }

  return { autoDeclined, declineNoticesFailed };
}

async function markEstimateFollowUps(db, clientId, now) {
  const preClientsRef = db.collection("ocmClients").doc(clientId).collection("preClients");
  const snapshot = await preClientsRef.get();
  let followUpsMarked = 0;
  let movedToClients = 0;

  for (const documentSnapshot of snapshot.docs) {
    const row = documentSnapshot.data();
    const recordRef = preClientsRef.doc(documentSnapshot.id);

    if (
      row.EstimateFollowUpAt
      && !row.WorkStartDate
      && !row.EstimateFollowUpDue
      && Date.parse(row.EstimateFollowUpAt) <= now.getTime()
    ) {
      await recordRef.set({
        EstimateFollowUpDue: true,
        EstimateFollowUpMarkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      followUpsMarked += 1;
    }

    if (row.WorkStartDate && isDateDue(row.WorkStartDate, now)) {
      const clientRef = db.collection("ocmClients").doc(clientId).collection("clients").doc(documentSnapshot.id);
      const batch = db.batch();
      batch.set(clientRef, {
        ...row,
        currentStage: "clients",
        previousStage: "preClients",
        workStartedAt: FieldValue.serverTimestamp(),
        autoMovedOnStartDate: true,
        movedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.delete(recordRef);
      await batch.commit();
      movedToClients += 1;
    }
  }

  return { followUpsMarked, movedToClients };
}

async function createDailyReviewNotification(db, clientId, now) {
  const clock = businessNow(now);
  if (clock.hour < 17) return false;

  const notificationRef = db
    .collection("ocmClients")
    .doc(clientId)
    .collection("notifications")
    .doc(`daily-review-${clock.dateKey}`);
  const existing = await notificationRef.get();
  if (existing.exists) return false;

  await notificationRef.set({
    type: "daily-review",
    title: "Daily review",
    message: "Go review your clients.",
    dateKey: clock.dateKey,
    timeZone: clock.timeZone,
    scheduledHour: 17,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    dismissed: false,
  });

  return true;
}

async function runWorkflow(request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized. Match the GitHub CRON_SECRET to the Vercel CRON_SECRET." }, { status: 401 });
  }

  const missing = missingFirebaseAdminVariables();
  if (missing.length) {
    return Response.json(
      { ok: false, error: `Server setup is incomplete. Missing Vercel variables: ${missing.join(", ")}.` },
      { status: 503 }
    );
  }

  try {
    const now = new Date();
    const db = getAdminDb();
    const activeBusinesses = await listActiveBusinesses(db);
    const businesses = [];

    for (const [clientId, business] of activeBusinesses) {
      const expired = await autoDeclineExpiredEstimateRequests(db, clientId, business, now);
      const workflow = await markEstimateFollowUps(db, clientId, now);
      const dailyReviewCreated = await createDailyReviewNotification(db, clientId, now);
      businesses.push({ clientId, ...expired, ...workflow, dailyReviewCreated });
    }

    return Response.json({
      ok: true,
      checkedAt: now.toISOString(),
      businessClock: businessNow(now),
      businesses,
    });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: safeWorkflowError(error) }, { status: 500 });
  }
}

export async function GET(request) {
  return runWorkflow(request);
}

export async function POST(request) {
  return runWorkflow(request);
}
