import { createHash, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../lib/firebase-admin";
import {
  leadContactFieldDeletionPatch,
  stripLeadContactFields,
} from "../../lib/leadContactFields";
import { sendNewLeadNotification } from "../../lib/notificationService";
import {
  createJob,
  mergeJobs,
  normalizeAddressKey,
  normalizeJobs,
  uniqueTexts,
} from "../../lib/propertyProfiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedSections = ["clients", "contactedMe"];

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanSectionKey(value) {
  return allowedSections.includes(value) ? value : "contactedMe";
}

function text(value) {
  return String(value || "").trim();
}

async function readRequestData(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }
  return request.json();
}

function secretMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedHash = createHash("sha256").update(String(expected)).digest();
  const providedHash = createHash("sha256").update(String(provided)).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-ARK-Connection-Key",
  };
}

function safeSubmission(data) {
  const blocked = new Set(["connectionKey", "key", "authToken", "apiKey", "secret"]);
  const sanitized = stripLeadContactFields(data || {});
  return Object.fromEntries(
    Object.entries(sanitized).filter(([field]) => !blocked.has(field))
  );
}

function nameFields(data) {
  let FirstName = text(data.FirstName || data.firstName || data.givenName);
  let LastName = text(data.LastName || data.lastName || data.familyName);
  let Name = text(data.Name || data.name || data.fullName || data.customerName || data.ProfileName);

  if (!Name) Name = [FirstName, LastName].filter(Boolean).join(" ");
  if ((!FirstName || !LastName) && Name) {
    const parts = Name.split(/\s+/).filter(Boolean);
    if (!FirstName) FirstName = parts.shift() || "";
    if (!LastName) LastName = parts.join(" ");
  }

  return { FirstName, LastName, Name };
}

function addressFields(data) {
  const StreetAddress = text(
    data.StreetAddress || data.streetAddress || data.addressLine1 || data.street
  );
  const TownOrCity = text(
    data.TownOrCity || data.townOrCity || data.city || data.town || data.locality
  );
  const explicitAddress = text(data.Address || data.address || data.customerAddress);
  const Address = explicitAddress || [StreetAddress, TownOrCity].filter(Boolean).join(", ");
  return { StreetAddress, TownOrCity, Address };
}

function fallbackPropertyKey(address, phone) {
  const addressKey = normalizeAddressKey(address);
  if (addressKey) return addressKey;
  const phoneKey = String(phone || "").replace(/\D/g, "");
  if (phoneKey) return `phone-${phoneKey}`;
  return "";
}

function buildRow(input, source) {
  const data = stripLeadContactFields(input || {});
  const { FirstName, LastName, Name } = nameFields(data);
  const Phone = text(data.Phone || data.phone || data.phoneNumber || data.contact || data.From || data.Caller);
  const { StreetAddress, TownOrCity, Address } = addressFields(data);

  return {
    FirstName,
    LastName,
    Name,
    Phone,
    StreetAddress,
    TownOrCity,
    Address,
    PropertyKey: fallbackPropertyKey(Address, Phone),
    ContactNames: uniqueTexts(Name),
    Phones: uniqueTexts(Phone),
    Job: text(
      data.Job || data.job || data.ServiceType || data.serviceType || data.service || data.projectType || data.requestedService
    ),
    PreferredDay: text(data.PreferredDay || data.preferredDay || data.estimateDay),
    PreferredTime: text(data.PreferredTime || data.estimateTime || data.preferredTime),
    Notes: text(data.Notes || data.notes || data.message || data.summary || data.Body || data.TranscriptionText || data.CallStatus),
    source,
    rawSubmission: safeSubmission(data),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function findPropertyMatches(db, clientId, propertyKey) {
  if (!propertyKey) return [];

  const matches = [];
  for (const stageKey of allowedSections) {
    const snapshot = await db.collection("ocmClients").doc(clientId).collection(stageKey).get();
    snapshot.docs.forEach((documentSnapshot) => {
      const data = stripLeadContactFields(documentSnapshot.data());
      const existingAddress = data.Address || [data.StreetAddress, data.TownOrCity].filter(Boolean).join(", ");
      const existingKey = data.PropertyKey || fallbackPropertyKey(existingAddress, data.Phone || data.phone);
      if (existingKey === propertyKey) {
        matches.push({ stageKey, id: documentSnapshot.id, ref: documentSnapshot.ref, data });
      }
    });
  }

  return matches;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  return Response.json({
    ok: true,
    service: "ark-ocm-intake",
    message: "Use an administrator-generated business connection URL to submit leads.",
  });
}

export async function POST(request) {
  try {
    const url = new URL(request.url);
    const data = stripLeadContactFields(await readRequestData(request));
    const clientId = cleanClientId(data.clientId || url.searchParams.get("clientId"));
    const providedKey = text(
      request.headers.get("x-ark-connection-key") ||
      data.connectionKey ||
      data.key ||
      url.searchParams.get("key")
    );

    if (!clientId || !providedKey) {
      return Response.json(
        { ok: false, error: "Use the private webhook URL generated from ARK OCM Connections." },
        { status: 401, headers: corsHeaders() }
      );
    }

    const db = getAdminDb();
    const [businessSnapshot, connectionSnapshot] = await Promise.all([
      db.collection("businesses").doc(clientId).get(),
      db.collection("connections").doc(clientId).get(),
    ]);

    if (!businessSnapshot.exists || businessSnapshot.data().status !== "active") {
      return Response.json(
        { ok: false, error: "That business account is not active." },
        { status: 404, headers: corsHeaders() }
      );
    }

    if (!connectionSnapshot.exists) {
      return Response.json(
        { ok: false, error: "This business has not been connected by the administrator." },
        { status: 403, headers: corsHeaders() }
      );
    }

    const connection = connectionSnapshot.data();
    if (connection.enabled === false || !secretMatches(connection.connectionKey, providedKey)) {
      return Response.json(
        { ok: false, error: "This connection is disabled or the connection key is invalid." },
        { status: 403, headers: corsHeaders() }
      );
    }

    const requestedStage = cleanSectionKey(data.sectionKey || data.section || data.status);
    const sectionKey = connection.allowStageOverride === true
      ? requestedStage
      : cleanSectionKey(connection.defaultStage);
    const channel = text(url.searchParams.get("source") || data.source || (data.From || data.Caller ? "phone" : "website")).toLowerCase();
    const source = text(connection.sourceLabel)
      ? `${text(connection.sourceLabel)}${channel ? ` (${channel})` : ""}`
      : channel || "website";
    const row = buildRow(data, source);

    if (!row.Name && !row.Phone && !row.Notes) {
      return Response.json(
        { ok: false, error: "Send at least a name, phone number, or message." },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!row.PropertyKey) {
      return Response.json(
        { ok: false, error: "Send at least a property address or phone number." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const matches = await findPropertyMatches(db, clientId, row.PropertyKey);
    const existingInTarget = matches.find((match) => match.stageKey === sectionKey);
    const primary = existingInTarget || matches[0] || null;
    const primaryData = stripLeadContactFields(primary?.data || {});
    const targetCollection = db.collection("ocmClients").doc(clientId).collection(sectionKey);
    const targetRef = primary ? targetCollection.doc(primary.id) : targetCollection.doc();

    const previousJobs = mergeJobs(
      ...matches.map((match) => normalizeJobs(match.data, match.stageKey))
    );
    const nextJob = createJob(row, previousJobs.length + 1, sectionKey);
    const Jobs = mergeJobs(previousJobs, nextJob);

    const ContactNames = uniqueTexts(
      ...matches.map((match) => match.data.ContactNames || match.data.Name),
      row.ContactNames
    );
    const Phones = uniqueTexts(
      ...matches.map((match) => match.data.Phones || match.data.Phone),
      row.Phones
    );

    const batch = db.batch();
    batch.set(targetRef, {
      ...primaryData,
      ...row,
      FirstName: row.FirstName || primaryData.FirstName || "",
      LastName: row.LastName || primaryData.LastName || "",
      Name: row.Name || ContactNames.at(-1) || primaryData.Name || "",
      Phone: row.Phone || Phones.at(-1) || primaryData.Phone || "",
      StreetAddress: row.StreetAddress || primaryData.StreetAddress || "",
      TownOrCity: row.TownOrCity || primaryData.TownOrCity || "",
      Address: row.Address || primaryData.Address || "",
      PropertyKey: row.PropertyKey || primaryData.PropertyKey || "",
      ContactNames,
      Phones,
      Jobs,
      TotalJobs: Jobs.length,
      RepeatJobs: Math.max(0, Jobs.length - 1),
      currentStage: sectionKey,
      connectionClientId: clientId,
      createdAt: primaryData.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...leadContactFieldDeletionPatch(FieldValue.delete()),
    }, { merge: true });

    matches.forEach((match) => {
      if (match.ref.path !== targetRef.path) batch.delete(match.ref);
    });

    batch.set(connectionSnapshot.ref, {
      lastLeadAt: FieldValue.serverTimestamp(),
      lastLeadSource: source,
      lastLeadDocumentId: targetRef.id,
      lastLeadStage: sectionKey,
    }, { merge: true });

    await batch.commit();

    if (sectionKey === "contactedMe") {
      try {
        await sendNewLeadNotification({ db, clientId, row, leadId: targetRef.id });
      } catch (notificationError) {
        console.error("Lead saved but push notification delivery failed", notificationError);
      }
    }

    return Response.json(
      {
        ok: true,
        id: targetRef.id,
        clientId,
        sectionKey,
        propertyKey: row.PropertyKey,
        totalJobs: Jobs.length,
        repeatClient: Jobs.length > 1,
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Unable to process connected intake", error);
    return Response.json(
      { ok: false, error: "Could not save the intake submission." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
