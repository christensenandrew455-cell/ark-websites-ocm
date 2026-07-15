import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIPELINE_STAGES = ["contactedMe", "preClients", "clients", "postClients"];

function text(value) {
  return String(value || "").trim();
}

function accountPatch(clientId, business) {
  const businessName = text(business.businessName || clientId);
  const ownerName = text(business.ownerName || businessName);
  const phone = text(business.accountPhone);
  const email = text(business.accountEmail).toLowerCase();

  return {
    Name: ownerName,
    BusinessName: businessName,
    Phone: phone,
    Email: email,
    Address: businessName,
    PropertyKey: `business-${clientId}`,
    Job: "ARK OCM account",
    BestContactMethod: phone ? "Call" : "Email",
    Notes: `ARK OCM customer account for ${businessName}.`,
    source: "business-account",
    RelatedBusinessClientId: clientId,
    AccountStatus: text(business.status || "active"),
    ContactNames: ownerName ? [ownerName] : [],
    Phones: phone ? [phone] : [],
    Emails: email ? [email] : [],
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const db = getAdminDb();
  const adminClientId = text(admin.decodedToken.clientId || process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
  if (!adminClientId) {
    return NextResponse.json({ error: "The administrator account does not have a client ID." }, { status: 400 });
  }

  const [businessSnapshot, ...stageSnapshots] = await Promise.all([
    db.collection("businesses").get(),
    ...PIPELINE_STAGES.map((stage) => db.collection("ocmClients").doc(adminClientId).collection(stage).get()),
  ]);

  const existingAccounts = new Map();
  stageSnapshots.forEach((snapshot, index) => {
    const stage = PIPELINE_STAGES[index];
    snapshot.docs.forEach((document) => {
      const data = document.data();
      const relatedClientId = text(data.RelatedBusinessClientId || document.id);
      if (relatedClientId) existingAccounts.set(relatedClientId, { ref: document.ref, stage });
    });
  });

  const activeBusinesses = businessSnapshot.docs
    .map((document) => ({ clientId: document.id, ...document.data() }))
    .filter((business) => business.status === "active" && business.clientId !== adminClientId);

  if (!activeBusinesses.length) {
    return NextResponse.json({ ok: true, adminClientId, created: 0, updated: 0 });
  }

  const batch = db.batch();
  let created = 0;
  let updated = 0;

  activeBusinesses.forEach((business) => {
    const current = existingAccounts.get(business.clientId);
    const patch = accountPatch(business.clientId, business);

    if (current) {
      batch.set(current.ref, patch, { merge: true });
      updated += 1;
      return;
    }

    const clientRef = db.collection("ocmClients").doc(adminClientId).collection("clients").doc(business.clientId);
    batch.set(clientRef, {
      ...patch,
      currentStage: "clients",
      TotalJobs: 1,
      RepeatJobs: 0,
      createdAt: business.createdAt || FieldValue.serverTimestamp(),
      movedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    created += 1;
  });

  await batch.commit();
  return NextResponse.json({ ok: true, adminClientId, created, updated });
}
