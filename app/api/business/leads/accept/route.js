import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { sendEstimateRequestStatusNotice } from "../../../../lib/estimateRequestStatusNotice";
import { stripLeadContactFields } from "../../../../lib/leadContactFields";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (decoded.role !== "customer" || !clientId) {
    return NextResponse.json({ error: "An owner account is required." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    if (!leadId) return NextResponse.json({ error: "Choose an estimate request to accept." }, { status: 400 });

    const db = getAdminDb();
    const [accountSnapshot, businessSnapshot] = await Promise.all([
      db.collection("accounts").doc(decoded.uid).get(),
      db.collection("businesses").doc(clientId).get(),
    ]);
    if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || !businessSnapshot.exists) {
      return NextResponse.json({ error: "An active owner account is required." }, { status: 403 });
    }

    const root = db.collection("ocmClients").doc(clientId);
    const sourceRef = root.collection("contactedMe").doc(leadId);
    const sourceSnapshot = await sourceRef.get();
    if (!sourceSnapshot.exists) {
      const acceptedSnapshot = await root.collection("clients").doc(leadId).get();
      if (acceptedSnapshot.exists) return NextResponse.json({ ok: true, duplicate: true });
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
    await batch.commit();

    const business = businessSnapshot.data();
    const businessName = text(business.businessName || business.name) || "the business";
    const notice = await sendEstimateRequestStatusNotice({
      db,
      clientId,
      businessName,
      leadId,
      leadName: text(lead.Name || lead.name || lead.fullName),
      phone: text(lead.Phone || lead.phone || lead.phoneNumber),
      status: "accepted",
    });

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
