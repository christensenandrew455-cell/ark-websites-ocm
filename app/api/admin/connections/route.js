import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "../../../lib/accountRoles";
import { requireAdmin } from "../../../lib/adminRequest";
import { publicBillingStatus } from "../../../lib/billingDelinquency";
import { getAdminDb } from "../../../lib/firebase-admin";
import { normalizeClientId, toIsoString, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasCompletedBusinessSetup(receptionist = {}) {
  if (receptionist.businessSetupComplete === true) return true;
  const services = receptionist.services && typeof receptionist.services === "object"
    ? Object.keys(receptionist.services)
    : [];
  return Boolean(
    trimmedText(receptionist.businessName)
    && trimmedText(receptionist.businessEmail)
    && trimmedText(receptionist.businessPhone)
    && services.length,
  );
}

function connectionPayload(clientId, account) {
  return {
    clientId,
    businessName: trimmedText(account.businessName || clientId),
    ownerName: trimmedText(account.ownerName),
    accountEmail: trimmedText(account.accountEmail).toLowerCase(),
    status: trimmedText(account.status || "active"),
    disabledAt: toIsoString(account.disabledAt),
    enabled: account.enabled !== false,
    phone: trimmedText(account.notificationPhone || account.businessPhone || account.accountPhone),
    sourceLabel: trimmedText(account.sourceLabel || account.businessName || clientId),
    connectionKey: trimmedText(account.connectionKey),
    receptionistConfigured: hasCompletedBusinessSetup(account),
    receptionistEnabled: account.receptionistEnabled !== false,
    receptionistPhone: trimmedText(account.receptionistPhone),
    termsAccepted: account.termsAccepted === true,
    privacyAccepted: account.privacyAccepted === true,
    termsVersion: trimmedText(account.termsVersion),
    privacyVersion: trimmedText(account.privacyVersion),
    legalAcceptedAt: toIsoString(account.legalAcceptedAt),
    legalAcceptedBy: trimmedText(account.legalAcceptedBy || account.accountEmail).toLowerCase(),
    legalAcceptanceSource: trimmedText(account.legalAcceptanceSource),
    billing: publicBillingStatus(account),
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").get();

  const adminUid = trimmedText(admin.decodedToken.uid);
  const adminEmail = trimmedText(admin.decodedToken.email).toLowerCase();
  const businesses = accountSnapshot.docs
    .map((document) => ({ clientId: document.id, account: document.data() }))
    .filter(({ account }) => isStandardRole(account.role))
    .filter(({ account }) => trimmedText(account.uid) !== adminUid)
    .filter(({ account }) => !adminEmail || trimmedText(account.accountEmail).toLowerCase() !== adminEmail)
    .filter(({ account }) => ["active", "disabled"].includes(trimmedText(account.status || "active")))
    .map(({ clientId, account }) => connectionPayload(clientId, account))
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
  const accountRef = db.collection("accounts").doc(clientId);
  const accountSnapshot = await accountRef.get();

  if (!accountSnapshot.exists || !isStandardRole(accountSnapshot.data().role)) {
    return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  }

  const account = accountSnapshot.data();
  const connectionKey = trimmedText(account.connectionKey) || randomBytes(24).toString("hex");
  const phone = trimmedText(body.phone || account.notificationPhone || account.businessPhone || account.accountPhone);
  const ownerName = trimmedText(body.ownerName || account.ownerName);
  const sourceLabel = trimmedText(body.sourceLabel || account.businessName || clientId);

  const data = {
    clientId,
    businessName: trimmedText(account.businessName || clientId),
    ownerName,
    enabled: body.enabled !== false && account.status !== "disabled",
    businessPhone: phone,
    notificationPhone: phone,
    notificationEmail: trimmedText(account.accountEmail).toLowerCase(),
    sourceLabel,
    defaultStage: "contactedMe",
    allowStageOverride: false,
    connectionKey,
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await accountRef.set({
    ...data,
    ownerName,
    accountPhone: phone || account.accountPhone || "",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return NextResponse.json({
    connection: connectionPayload(clientId, { ...account, ...data, ownerName, accountPhone: phone }),
  });
}
