import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function cleanClientId(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function businessInfoObject(body) {
  const services = list(body.services);
  const serviceDescriptions = Object.fromEntries(services.map((service) => [service.toLowerCase(), `${service}.`]));

  return {
    name: text(body.businessName),
    receptionist: text(body.receptionistName || "Alex"),
    owner: text(body.ownerName),
    phone: text(body.businessPhone || body.accountPhone),
    email: text(body.notificationEmail || body.accountEmail).toLowerCase(),
    hours: text(body.businessHours || "Monday through Friday, 8 AM to 5 PM"),
    estimateDays: text(body.estimateDays || "Monday through Friday"),
    earliestEstimateStart: text(body.earliestEstimateStart || "9:00 AM"),
    latestEstimateStart: text(body.latestEstimateStart || "4:30 PM"),
    base: text(body.businessBase),
    serviceAreas: list(body.serviceAreas),
    services: serviceDescriptions,
    about: list(body.about),
    extraInformation: text(body.businessInfo),
    receptionistInstructions: text(body.receptionistInstructions),
  };
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  let createdUser = null;
  let committed = false;

  try {
    const body = await request.json();
    const businessName = text(body.businessName);
    const ownerName = text(body.ownerName);
    const accountEmail = text(body.accountEmail).toLowerCase();
    const accountPhone = text(body.accountPhone);
    const temporaryPassword = String(body.temporaryPassword || "");
    const clientId = cleanClientId(body.clientId || businessName);

    if (!businessName || !ownerName || !clientId) {
      return NextResponse.json({ error: "Business name, owner name, and client ID are required." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
      return NextResponse.json({ error: "Enter a valid customer login email." }, { status: 400 });
    }
    if (temporaryPassword.length < 8) {
      return NextResponse.json({ error: "The temporary password must be at least 8 characters." }, { status: 400 });
    }

    const db = getAdminDb();
    const auth = getAdminAuth();
    const businessRef = db.collection("businesses").doc(clientId);
    const [businessSnapshot, existingUser] = await Promise.all([
      businessRef.get(),
      auth.getUserByEmail(accountEmail).catch(() => null),
    ]);

    if (businessSnapshot.exists) {
      return NextResponse.json({ error: "That client ID is already in use." }, { status: 409 });
    }
    if (existingUser) {
      return NextResponse.json({ error: "That login email already has an account." }, { status: 409 });
    }

    createdUser = await auth.createUser({
      email: accountEmail,
      password: temporaryPassword,
      displayName: ownerName,
      emailVerified: false,
    });
    await auth.setCustomUserClaims(createdUser.uid, { role: "customer", clientId });

    const connectionKey = randomBytes(24).toString("hex");
    const info = businessInfoObject(body);
    const sourceLabel = text(body.sourceLabel || `${businessName} receptionist`);
    const notificationEmail = text(body.notificationEmail || accountEmail).toLowerCase();
    const businessPhone = text(body.businessPhone || accountPhone);

    const accountData = {
      uid: createdUser.uid,
      clientId,
      role: "customer",
      businessName,
      ownerName,
      accountEmail,
      accountPhone,
      status: "active",
      paymentSetupStatus: "admin-created",
      createdBy: admin.decodedToken.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const connectionData = {
      clientId,
      businessName,
      ownerName,
      receptionistName: info.receptionist,
      enabled: true,
      websiteUrl: "",
      businessPhone,
      notificationPhone: accountPhone,
      notificationEmail,
      sourceLabel,
      defaultStage: "contactedMe",
      allowStageOverride: false,
      notes: "",
      connectionKey,
      businessHours: info.hours,
      estimateDays: info.estimateDays,
      earliestEstimateStart: info.earliestEstimateStart,
      latestEstimateStart: info.latestEstimateStart,
      businessBase: info.base,
      serviceAreas: info.serviceAreas.join(", "),
      services: Object.keys(info.services).join("\n"),
      about: info.about.join("\n"),
      businessInfo: info.extraInformation,
      receptionistInstructions: info.receptionistInstructions,
      updatedBy: admin.decodedToken.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(db.collection("accounts").doc(createdUser.uid), accountData);
    batch.set(businessRef, accountData);
    batch.set(db.collection("connections").doc(clientId), connectionData);
    batch.set(db.collection("ocmClients").doc(clientId), {
      businessName,
      ownerUid: createdUser.uid,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), {
      BusinessName: businessName,
      OwnerName: ownerName,
      AccountEmail: accountEmail,
      AccountPhone: accountPhone,
      NotificationEmail: notificationEmail,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist"), {
      ...info,
      sourceLabel,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
    if (adminClientId && adminClientId !== clientId) {
      batch.set(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId), {
        Name: ownerName,
        BusinessName: businessName,
        Phone: accountPhone,
        Email: accountEmail,
        Address: businessName,
        PropertyKey: `business-${clientId}`,
        Job: "OCM customer account",
        BestContactMethod: accountPhone ? "Call" : "Email",
        Notes: `OCM customer account for ${businessName}.`,
        source: "admin-onboarding",
        RelatedBusinessClientId: clientId,
        AccountStatus: "active",
        currentStage: "clients",
        TotalJobs: 1,
        RepeatJobs: 0,
        createdAt: FieldValue.serverTimestamp(),
        movedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();
    committed = true;

    return NextResponse.json({
      ok: true,
      clientId,
      businessName,
      accountEmail,
      connectionKey,
      businessInfo: JSON.stringify(info),
    }, { status: 201 });
  } catch (error) {
    console.error("Unable to create customer account", error);
    if (createdUser?.uid && !committed) {
      await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    }
    return NextResponse.json({ error: "Could not create the customer account. Check the server logs for details." }, { status: 500 });
  }
}
