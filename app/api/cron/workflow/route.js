import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../lib/firebase-admin";
import { businessNow, isDateDue } from "../../../lib/businessTime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_CLIENT_ID = "tabor-painting";

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
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

async function listActiveClientIds(db) {
  const snapshot = await db.collection("businesses").where("status", "==", "active").get();
  return [...new Set([LEGACY_CLIENT_ID, ...snapshot.docs.map((documentSnapshot) => documentSnapshot.id)])];
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
    const clientIds = await listActiveClientIds(db);
    const businesses = [];

    for (const clientId of clientIds) {
      const workflow = await markEstimateFollowUps(db, clientId, now);
      const dailyReviewCreated = await createDailyReviewNotification(db, clientId, now);
      businesses.push({ clientId, ...workflow, dailyReviewCreated });
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
