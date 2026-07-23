import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { publicBillingStatus } from "../../../lib/billingDelinquency";
import { getAdminDb } from "../../../lib/firebase-admin";
import { normalizeClientId, toIsoString, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectionPayload(clientId, business, data, receptionist = null) {
  return {
    clientId,
    businessName: trimmedText(business.businessName || data.businessName || clientId),
    ownerName: trimmedText(data.ownerName || business.ownerName),
    accountEmail: trimmedText(business.accountEmail).toLowerCase(),
    status: trimmedText(business.status || "active"),
    disabledAt: toIsoString(business.disabledAt || data.disabledAt),
    enabled: data.enabled !== false,
    phone: trimmedText(data.notificationPhone || data.businessPhone || business.accountPhone),
    sourceLabel: trimmedText(data.sourceLabel || business.businessName || clientId),
    connectionKey: trimmedText(data.connectionKey),
    receptionistConfigured: Boolean(receptionist),
    receptionistEnabled: receptionist?.enabled !== false,
    receptionistPhone: trimmedText(receptionist?.receptionistPhone || data.receptionistPhone),
    termsAccepted: business.termsAccepted === true,
    privacyAccepted: business.privacyAccepted === true,
    termsVersion: trimmedText(business.termsVersion),
    privacyVersion: trimmedText(business.privacyVersion),
    legalAcceptedAt: toIsoString(business.legalAcceptedAt),
    legalAcceptedBy: trimmedText(business.legalAcceptedBy || business.accountEmail).toLowerCase(),
    legalAcceptanceSource: trimmedText(business.legalAcceptanceSource),
    billing: publicBillingStatus(business),
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const db = getAdminDb();
  const [businessSnapshot, connectionSnapshot] = await Promise.all([
    db.collection("businesses").get(),
    db.collection("connections").get(),
  ]);

  const adminUid = trimmedText(admin.decodedToken.uid);
  const adminEmail = trimmedText(admin.decodedToken.email).toLowerCase();
  const connections = new Map(connectionSnapshot.docs.map((document) => [document.id, document.data()]));
  const eligible = businessSnapshot.docs
    .map((document) => ({ clientId: document.id, business: document.data() }))
    .filter(({ business }) => trimmedText(business.uid) !== adminUid)
    .filter(({ business }) => !adminEmail || trimmedText(business.accountEmail).toLowerCase() !== adminEmail)
    .filter(({ business }) => ["active", "disabled", "approved_pending_payment"].includes(trimmedText(business.status || "active")));

  const receptionistSnapshots = eligible.length
    ? await db.getAll(...eligible.map(({ clientId }) => db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist")))
    : [];

  const businesses = eligible
    .map(({ clientId, business }, index) => connectionPayload(
      clientId,
      business,
      connections.get(clientId) || {},
      receptionistSnapshots[index]?.exists ? receptionistSnapshots[index].data() : null,
    ))
    .filter((business) => business.businessName)
    .sort((a, b) => a.businessName.localeCompare(b.businessName));

  return NextResponse.json({ businesses });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const body = await request.json();
  const clientId = normalizeClientId(body.clientId);
  if (!clientId) return NextResponse.json({ error: "Choose a business account." }, { status: 400 });

  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(clientId);
  const connectionRef = db.collection("connections").doc(clientId);
  const receptionistRef = db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist");
  const [businessSnapshot, connectionSnapshot, receptionistSnapshot] = await Promise.all([
    businessRef.get(),
    connectionRef.get(),
    receptionistRef.get(),
  ]);

  if (!businessSnapshot.exists) {
    return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  }

  const business = businessSnapshot.data();
  const current = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const connectionKey = trimmedText(current.connectionKey) || randomBytes(24).toString("hex");
  const phone = trimmedText(body.phone || current.notificationPhone || current.businessPhone || business.accountPhone);
  const ownerName = trimmedText(body.ownerName || business.ownerName);
  const sourceLabel = trimmedText(body.sourceLabel || business.businessName || clientId);

  const data = {
    clientId,
    businessName: trimmedText(business.businessName || clientId),
    ownerName,
    enabled: body.enabled !== false && business.status !== "disabled",
    businessPhone: phone,
    notificationPhone: phone,
    notificationEmail: trimmedText(business.accountEmail).toLowerCase(),
    sourceLabel,
    defaultStage: "contactedMe",
    allowStageOverride: false,
    connectionKey,
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(connectionSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  const batch = db.batch();
  batch.set(connectionRef, data, { merge: true });
  batch.set(businessRef, {
    ownerName,
    accountPhone: phone || business.accountPhone || "",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), {
    BusinessName: data.businessName,
    OwnerName: ownerName,
    AccountEmail: trimmedText(business.accountEmail).toLowerCase(),
    AccountPhone: phone,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return NextResponse.json({
    connection: connectionPayload(
      clientId,
      { ...business, ownerName, accountPhone: phone },
      data,
      receptionistSnapshot.exists ? receptionistSnapshot.data() : null,
    ),
  });
}
