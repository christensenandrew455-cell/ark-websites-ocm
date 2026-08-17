import { FieldValue } from "firebase-admin/firestore";
import { isStandardRole } from "../../../lib/accountRoles";
import { purgeExpiredUnverifiedAccounts } from "../../../lib/accountVerificationCleanup";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { purgeExpiredPendingOwnerSignups } from "../../../lib/pendingOwnerSignup";
import { businessNow, isDateDue } from "../../../lib/businessTime";
import {
  estimateRequestCreatedAt,
  estimateRequestLifecycle,
} from "../../../lib/estimateRequestLifecycle";
import { sendEstimateRequestStatusNotice } from "../../../lib/estimateRequestStatusNotice";
import { cleanupExpiredClients, normalizeClientRetentionDays } from "../../../lib/clientRetention";
import { cleanupExpiredLeads, normalizeLeadRetentionDays } from "../../../lib/leadRetention";
import { validTimeZone } from "../../../lib/timeWindows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) {
  return String(value || "").trim();
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
  const snapshot = await db.collection("accounts").where("status", "==", "active").get();
  return new Map(snapshot.docs
    .filter((documentSnapshot) => isStandardRole(documentSnapshot.data().role))
    .map((documentSnapshot) => [documentSnapshot.id, documentSnapshot.data()]));
}

async function accountTimeZone(business = {}) {
  return validTimeZone(text(business.timeZone));
}

async function autoDeclineExpiredEstimateRequests(db, clientId, business, now) {
  const contactedRef = db.collection("accounts").doc(clientId).collection("contactedMe");
  const snapshot = await contactedRef.get();
  let autoDeclined = 0;
  let declineNoticesFailed = 0;

  for (const documentSnapshot of snapshot.docs) {
    const lead = documentSnapshot.data();
    const createdAt = estimateRequestCreatedAt(lead);
    if (!estimateRequestLifecycle(createdAt, now).expired) continue;

    if (business?.clientDeclineNoticeEnabled !== false) {
      try {
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
      } catch (error) {
        declineNoticesFailed += 1;
        console.error(`Auto-decline notice failed for ${clientId}/${documentSnapshot.id}`, error);
      }
    }

    await documentSnapshot.ref.delete();
    autoDeclined += 1;
  }

  return { autoDeclined, declineNoticesFailed };
}

async function markEstimateFollowUps(db, clientId, now, timeZone) {
  const preClientsRef = db.collection("accounts").doc(clientId).collection("preClients");
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

    if (row.WorkStartDate && isDateDue(row.WorkStartDate, now, timeZone)) {
      const clientRef = db.collection("accounts").doc(clientId).collection("clients").doc(documentSnapshot.id);
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

async function createDailyReviewNotification(db, clientId, now, timeZone) {
  const clock = businessNow(now, timeZone);
  if (clock.hour < 17) return false;

  const notificationRef = db
    .collection("accounts")
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
    const expiredTemporarySignups = await purgeExpiredPendingOwnerSignups({ db, auth: getAdminAuth(), now });
    const expiredUnverifiedAccounts = await purgeExpiredUnverifiedAccounts({ db, now });
    const activeBusinesses = await listActiveBusinesses(db);
    const businesses = [];

    for (const [clientId, business] of activeBusinesses) {
      try {
        const timeZone = await accountTimeZone(business);
        const expired = await autoDeclineExpiredEstimateRequests(db, clientId, business, now);
        const workflow = await markEstimateFollowUps(db, clientId, now, timeZone);
        const dailyReviewCreated = await createDailyReviewNotification(db, clientId, now, timeZone);
        const retentionDays = normalizeLeadRetentionDays(business.leadRetentionDays);
        const clientRetentionDays = normalizeClientRetentionDays(business.clientRetentionDays);
        const retainedLeadsDeleted = await cleanupExpiredLeads(db, clientId, retentionDays, now);
        const retainedClientsDeleted = await cleanupExpiredClients(db, clientId, clientRetentionDays, now);
        businesses.push({
          clientId,
          timeZone,
          retentionDays,
          clientRetentionDays,
          retainedLeadsDeleted,
          retainedClientsDeleted,
          ...expired,
          ...workflow,
          dailyReviewCreated,
        });
      } catch (error) {
        console.error(`Workflow failed for ${clientId}`, error);
        businesses.push({ clientId, error: String(error?.message || "Workflow failed.") });
      }
    }

    return Response.json({
      ok: true,
      checkedAt: now.toISOString(),
      expiredTemporarySignups,
      expiredUnverifiedAccounts,
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
