import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { businessNow, isDateDue } from "../../../lib/businessTime";

const CLIENT_ID = "tabor-painting";

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function markEstimateFollowUps(now) {
  const snapshot = await getDocs(collection(db, "ocmClients", CLIENT_ID, "preClients"));
  let followUpsMarked = 0;
  let movedToClients = 0;

  for (const documentSnapshot of snapshot.docs) {
    const row = documentSnapshot.data();
    const recordRef = doc(db, "ocmClients", CLIENT_ID, "preClients", documentSnapshot.id);

    if (
      row.EstimateFollowUpAt
      && !row.WorkStartDate
      && !row.EstimateFollowUpDue
      && Date.parse(row.EstimateFollowUpAt) <= now.getTime()
    ) {
      await setDoc(recordRef, {
        EstimateFollowUpDue: true,
        EstimateFollowUpMarkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      followUpsMarked += 1;
    }

    if (row.WorkStartDate && isDateDue(row.WorkStartDate, now)) {
      const clientRef = doc(db, "ocmClients", CLIENT_ID, "clients", documentSnapshot.id);
      const batch = writeBatch(db);
      batch.set(clientRef, {
        ...row,
        currentStage: "clients",
        previousStage: "preClients",
        workStartedAt: serverTimestamp(),
        autoMovedOnStartDate: true,
        movedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.delete(recordRef);
      await batch.commit();
      movedToClients += 1;
    }
  }

  return { followUpsMarked, movedToClients };
}

async function createDailyReviewNotification(now) {
  const clock = businessNow(now);
  if (clock.hour < 17) return false;

  const notificationRef = doc(
    db,
    "ocmClients",
    CLIENT_ID,
    "notifications",
    `daily-review-${clock.dateKey}`
  );
  const existing = await getDoc(notificationRef);
  if (existing.exists()) return false;

  await setDoc(notificationRef, {
    type: "daily-review",
    title: "Daily review",
    message: "Go review your clients.",
    dateKey: clock.dateKey,
    timeZone: clock.timeZone,
    scheduledHour: 17,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    dismissed: false,
  });

  return true;
}

async function runWorkflow(request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const workflow = await markEstimateFollowUps(now);
    const dailyReviewCreated = await createDailyReviewNotification(now);

    return Response.json({
      ok: true,
      checkedAt: now.toISOString(),
      businessClock: businessNow(now),
      ...workflow,
      dailyReviewCreated,
    });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: "Workflow check failed." }, { status: 500 });
  }
}

export async function GET(request) {
  return runWorkflow(request);
}

export async function POST(request) {
  return runWorkflow(request);
}
