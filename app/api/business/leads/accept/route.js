import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import {
  acceptedLeadAccountPatch,
  acceptedLeadEventData,
  acceptedLeadEventRef,
  acceptedLeadPlanStatus,
  countAcceptedClientsInPeriod,
  nextAcceptedLeadPlanStatus,
} from "../../../../lib/acceptedLeadPlanBilling";
import { isStandardRole } from "../../../../lib/accountRoles";
import { readAccountSections } from "../../../../lib/accountSections";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { estimateRequestStatusNoticesEnabled, sendEstimateRequestStatusNotice } from "../../../../lib/estimateRequestStatusNotice";
import { stripLeadContactFields } from "../../../../lib/leadContactFields";
import { requireUser } from "../../../../lib/userRequest";
import { serializeFirestoreValue } from "../../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function valueMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (!isStandardRole(decoded.role) || !clientId) {
    return NextResponse.json({ error: "An owner account is required." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    if (!leadId || leadId.includes("/")) {
      return NextResponse.json({ error: "Choose a valid service request to accept." }, { status: 400 });
    }

    const db = getAdminDb();
    const accountRef = db.collection("accounts").doc(clientId);
    const accountSnapshot = await accountRef.get();
    const accountData = accountSnapshot.exists ? accountSnapshot.data() : null;
    if (!accountData || accountData.status !== "active" || accountData.billingPastDue === true || text(accountData.uid) !== text(decoded.uid)) {
      return NextResponse.json({ error: "An active owner account is required." }, { status: 403 });
    }

    const initialPlan = acceptedLeadPlanStatus(accountData);
    const existingAcceptedCount = await countAcceptedClientsInPeriod(accountRef, initialPlan);
    const root = accountRef;
    const sourceRef = root.collection("contactedMe").doc(leadId);
    const targetRef = root.collection("clients").doc(leadId);
    const accepted = await db.runTransaction(async (transaction) => {
      const [freshAccountSnapshot, sourceSnapshot, targetSnapshot] = await Promise.all([
        transaction.get(accountRef),
        transaction.get(sourceRef),
        transaction.get(targetRef),
      ]);
      const freshAccount = freshAccountSnapshot.exists ? freshAccountSnapshot.data() : null;
      if (!freshAccount || freshAccount.status !== "active" || freshAccount.billingPastDue === true || text(freshAccount.uid) !== text(decoded.uid)) {
        return { forbidden: true };
      }

      const currentPlan = acceptedLeadPlanStatus(freshAccount);
      const minimumAcceptedCount = currentPlan.periodKey === initialPlan.periodKey
        ? existingAcceptedCount
        : currentPlan.acceptedLeadsUsed;
      const eventRef = acceptedLeadEventRef(db, {
        clientId,
        periodKey: currentPlan.periodKey,
        leadId,
      });
      const eventSnapshot = await transaction.get(eventRef);

      if (!sourceSnapshot.exists) {
        if (!targetSnapshot.exists) return { notFound: true };
        const target = stripLeadContactFields(targetSnapshot.data());
        const acceptedAtMs = valueMillis(target.acceptedAt || target.movedAt || target.updatedAt);
        const belongsToCurrentPeriod = acceptedAtMs >= new Date(currentPlan.periodStartAt).getTime()
          && acceptedAtMs < new Date(currentPlan.periodEndAt).getTime();
        let repairedPlan = acceptedLeadPlanStatus(freshAccount, new Date(), minimumAcceptedCount);
        if (!eventSnapshot.exists && belongsToCurrentPeriod) {
          repairedPlan = nextAcceptedLeadPlanStatus(freshAccount, {
            existingAcceptedCount: Math.max(1, minimumAcceptedCount),
            increment: false,
          });
          const countedAt = target.acceptedAt || target.movedAt || FieldValue.serverTimestamp();
          transaction.create(eventRef, acceptedLeadEventData({ clientId, leadId, status: repairedPlan, acceptedAt: countedAt }));
          transaction.set(targetRef, {
            acceptedLeadPeriodKey: repairedPlan.periodKey,
            acceptedLeadCountedAt: countedAt,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          transaction.set(accountRef, acceptedLeadAccountPatch(repairedPlan, countedAt), { merge: true });
        }
        return { duplicate: true, lead: target, plan: repairedPlan };
      }

      const currentWithLegacyLeads = acceptedLeadPlanStatus(freshAccount, new Date(), minimumAcceptedCount);
      if (!eventSnapshot.exists && currentWithLegacyLeads.limitReached) {
        return { limitReached: true, plan: currentWithLegacyLeads };
      }

      const lead = stripLeadContactFields(sourceSnapshot.data());
      const nextPlan = eventSnapshot.exists
        ? currentWithLegacyLeads
        : nextAcceptedLeadPlanStatus(freshAccount, { existingAcceptedCount: minimumAcceptedCount });
      const acceptedAt = FieldValue.serverTimestamp();
      transaction.set(targetRef, {
        ...lead,
        currentStage: "clients",
        previousStage: "contactedMe",
        reviewStatus: "accepted",
        acceptedAt,
        movedAt: acceptedAt,
        acceptedLeadPeriodKey: nextPlan.periodKey,
        acceptedLeadCountedAt: acceptedAt,
        updatedAt: acceptedAt,
      }, { merge: true });
      transaction.delete(sourceRef);
      if (!eventSnapshot.exists) {
        transaction.create(eventRef, acceptedLeadEventData({ clientId, leadId, status: nextPlan, acceptedAt }));
        transaction.set(accountRef, acceptedLeadAccountPatch(nextPlan, acceptedAt), { merge: true });
      }
      return { duplicate: eventSnapshot.exists, lead, plan: nextPlan };
    });

    if (accepted.forbidden) {
      return NextResponse.json({ error: "An active owner account is required." }, { status: 403 });
    }
    if (accepted.notFound) {
      return NextResponse.json({ error: "That service request is no longer available." }, { status: 404 });
    }
    if (accepted.limitReached) {
      return NextResponse.json({
        error: `I’m sorry, you’ve used all ${accepted.plan.acceptedLeadPeriodLimit} accepted leads available this billing month.`,
        code: "MONTHLY_ACCEPTED_LEAD_LIMIT_REACHED",
        plan: accepted.plan,
      }, { status: 402 });
    }

    const lead = accepted.lead;

    const account = (await readAccountSections(accountSnapshot)).combined;
    const businessName = text(account.businessName || account.name) || "the business";
    const notice = estimateRequestStatusNoticesEnabled(account)
      ? await sendEstimateRequestStatusNotice({
        db,
        clientId,
        businessName,
        leadId,
        leadName: text(lead.Name || lead.name || lead.fullName),
        phone: text(lead.Phone || lead.phone || lead.phoneNumber),
        status: "accepted",
      })
      : { ok: true, skipped: "disabled", sent: false };

    const acceptedSnapshot = await targetRef.get();
    return NextResponse.json({
      ok: true,
      duplicate: accepted.duplicate === true,
      acceptedLeadsUsed: accepted.plan.acceptedLeadsUsed,
      acceptedLeadsRemaining: accepted.plan.acceptedLeadsRemaining,
      monthlyAcceptedLeadLimit: accepted.plan.monthlyAcceptedLeadLimit,
      record: acceptedSnapshot.exists ? {
        id: acceptedSnapshot.id,
        collectionKey: "clients",
        ...stripLeadContactFields(serializeFirestoreValue(acceptedSnapshot.data())),
      } : null,
      noticeSent: notice.sent === true,
      noticeSkipped: notice.skipped || null,
      noticeError: notice.sent === false && !notice.skipped && !notice.duplicate ? notice.error || null : null,
    });
  } catch (error) {
    console.error("Unable to accept service request", error);
    return NextResponse.json({ error: "Could not accept this service request." }, { status: 500 });
  }
}
