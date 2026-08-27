import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../../lib/accountRoles";
import { readAccountSections } from "../../../../lib/accountSections";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { estimateRequestStatusNoticesEnabled, sendEstimateRequestStatusNotice } from "../../../../lib/estimateRequestStatusNotice";
import { stripLeadContactFields } from "../../../../lib/leadContactFields";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function alreadyExists(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  return Number(error?.code) === 6 || code === "already-exists" || code === "already_exists";
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
    if (!leadId) return NextResponse.json({ error: "Choose an estimate request to accept." }, { status: 400 });

    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(clientId).get();
    const accountData = accountSnapshot.exists ? accountSnapshot.data() : null;
    if (!accountData || accountData.status !== "active" || accountData.billingPastDue === true || text(accountData.uid) !== text(decoded.uid)) {
      return NextResponse.json({ error: "An active owner account is required." }, { status: 403 });
    }
    const root = db.collection("accounts").doc(clientId);
    const sourceRef = root.collection("contactedMe").doc(leadId);
    const sourceSnapshot = await sourceRef.get();
    if (!sourceSnapshot.exists) {
      const acceptedSnapshot = await root.collection("clients").doc(leadId).get();
      if (acceptedSnapshot.exists) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      return NextResponse.json({ error: "That estimate request is no longer available." }, { status: 404 });
    }

    const lead = stripLeadContactFields(sourceSnapshot.data());
    const targetRef = root.collection("clients").doc(leadId);
    const batch = db.batch();
    batch.set(targetRef, {
      ...lead,
      currentStage: "clients",
      previousStage: "contactedMe",
      reviewStatus: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      movedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.delete(sourceRef);
    try {
      await batch.commit();
    } catch (commitError) {
      if (alreadyExists(commitError)) {
        const [acceptedSnapshot, pendingSnapshot] = await Promise.all([targetRef.get(), sourceRef.get()]);
        if (acceptedSnapshot.exists && !pendingSnapshot.exists) {
          return NextResponse.json({ ok: true, duplicate: true });
        }
      }
      throw commitError;
    }

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

    return NextResponse.json({
      ok: true,
      noticeSent: notice.sent === true,
      noticeSkipped: notice.skipped || null,
      noticeError: notice.sent === false && !notice.skipped && !notice.duplicate ? notice.error || null : null,
    });
  } catch (error) {
    console.error("Unable to accept estimate request", error);
    return NextResponse.json({ error: "Could not accept this estimate request." }, { status: 500 });
  }
}
