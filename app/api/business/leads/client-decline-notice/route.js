import { NextResponse } from "next/server";
import { isStandardRole } from "../../../../lib/accountRoles";
import { getAdminDb } from "../../../../lib/firebase-admin";
import { sendEstimateRequestStatusNotice } from "../../../../lib/estimateRequestStatusNotice";
import { requireUser } from "../../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (!isStandardRole(decoded.role) || !clientId) {
    return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  }

  const db = getAdminDb();
  const [accountSnapshot, businessSnapshot] = await Promise.all([
    db.collection("accounts").doc(decoded.uid).get(),
    db.collection("businesses").doc(clientId).get(),
  ]);
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || !businessSnapshot.exists) {
    return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  }

  return { db, decoded, clientId, business: businessSnapshot.data() };
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;

  try {
    const body = await request.json();
    const leadId = text(body.leadId);
    const phone = text(body.phone);
    const leadName = text(body.name);
    if (!leadId) return NextResponse.json({ error: "A lead is required." }, { status: 400 });

    const root = access.db.collection("ocmClients").doc(access.clientId);
    const acceptedSnapshot = await root.collection("clients").doc(leadId).get();
    if (acceptedSnapshot.exists) return NextResponse.json({ ok: true, skipped: "accepted" });
    if (access.business.clientDeclineNoticeEnabled === false) {
      return NextResponse.json({ ok: true, skipped: "disabled" });
    }

    const businessName = text(access.business.businessName || access.business.name) || "the business";
    const result = await sendEstimateRequestStatusNotice({
      db: access.db,
      clientId: access.clientId,
      businessName,
      leadId,
      leadName,
      phone,
      status: "declined",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Unable to send client decline notice", error);
    return NextResponse.json({ error: "Could not send the client decline notice." }, { status: 500 });
  }
}
