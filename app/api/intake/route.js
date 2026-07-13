import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  createJob,
  mergeJobs,
  normalizeAddressKey,
  normalizeJobs,
  uniqueTexts,
} from "../../lib/propertyProfiles";

const DEFAULT_CLIENT_ID = "tabor-painting";
const allowedSections = ["postClients", "clients", "preClients", "contactedMe"];

function cleanClientId(value) {
  return (
    String(value || DEFAULT_CLIENT_ID)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || DEFAULT_CLIENT_ID
  );
}

function cleanSectionKey(value) {
  return allowedSections.includes(value) ? value : "contactedMe";
}

function text(value) {
  return String(value || "").trim();
}

function contactMethod(value) {
  const normalized = text(value).toLowerCase();
  if (["text", "sms", "message", "text message"].includes(normalized)) return "Text";
  if (["call", "phone", "telephone"].includes(normalized)) return "Call";
  if (["email", "e-mail"].includes(normalized)) return "Email";
  return "";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function buildRow(data) {
  const Name = text(data.Name || data.name || data.fullName || data.customerName);
  const Phone = text(data.Phone || data.phone || data.phoneNumber || data.contact);
  const Email = text(data.Email || data.email);
  const Address = text(data.Address || data.address || data.customerAddress);

  return {
    Name,
    Phone,
    Email,
    Address,
    PropertyKey: normalizeAddressKey(Address),
    ContactNames: uniqueTexts(Name),
    Phones: uniqueTexts(Phone),
    Emails: uniqueTexts(Email),
    Job: text(data.Job || data.job || data.service || data.projectType || data.requestedService),
    BestContactMethod: contactMethod(
      data.BestContactMethod || data.bestContactMethod || data.BestFormOfContact || data.bestFormOfContact || data.BestWayToContact || data.bestWayToContact || data.preferredContactMethod || data.contactMethod
    ),
    PreferredDay: text(data.PreferredDay || data.preferredDay || data.estimateDay),
    PreferredTime: text(data.PreferredTime || data.preferredTime || data.estimateTime),
    Notes: text(data.Notes || data.notes || data.message || data.summary),
    source: text(data.source || "website"),
    rawSubmission: data,
    updatedAt: serverTimestamp(),
  };
}

async function findPropertyMatches(clientId, propertyKey) {
  if (!propertyKey) return [];

  const matches = [];
  for (const stageKey of allowedSections) {
    const snapshot = await getDocs(collection(db, "ocmClients", clientId, stageKey));
    snapshot.docs.forEach((document) => {
      const data = document.data();
      const existingKey = data.PropertyKey || normalizeAddressKey(data.Address || data.address);
      if (existingKey === propertyKey) {
        matches.push({ stageKey, id: document.id, ref: document.ref, data });
      }
    });
  }

  return matches;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  try {
    const data = await request.json();
    const clientId = cleanClientId(data.clientId);
    const sectionKey = cleanSectionKey(data.sectionKey);
    const row = buildRow(data);

    if (!row.Name && !row.Phone && !row.Email && !row.Notes) {
      return Response.json(
        { ok: false, error: "Send at least a name, phone, email, or message." },
        { status: 400, headers: corsHeaders() }
      );
    }

    const matches = await findPropertyMatches(clientId, row.PropertyKey);
    const existingInTarget = matches.find((match) => match.stageKey === sectionKey);
    const primary = existingInTarget || matches[0] || null;
    const targetRef = primary
      ? doc(db, "ocmClients", clientId, sectionKey, primary.id)
      : doc(collection(db, "ocmClients", clientId, sectionKey));

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
    const Emails = uniqueTexts(
      ...matches.map((match) => match.data.Emails || match.data.Email),
      row.Emails
    );

    const batch = writeBatch(db);
    batch.set(targetRef, {
      ...(primary?.data || {}),
      ...row,
      Name: row.Name || ContactNames.at(-1) || primary?.data.Name || "",
      Phone: row.Phone || Phones.at(-1) || primary?.data.Phone || "",
      Email: row.Email || Emails.at(-1) || primary?.data.Email || "",
      Address: row.Address || primary?.data.Address || "",
      PropertyKey: row.PropertyKey || primary?.data.PropertyKey || "",
      ContactNames,
      Phones,
      Emails,
      Jobs,
      TotalJobs: Jobs.length,
      RepeatJobs: Math.max(0, Jobs.length - 1),
      currentStage: sectionKey,
      previousStage: primary?.stageKey || "",
      createdAt: primary?.data.createdAt || serverTimestamp(),
      movedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    matches.forEach((match) => {
      if (match.ref.path !== targetRef.path) batch.delete(match.ref);
    });

    await batch.commit();

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
    console.error(error);
    return Response.json(
      { ok: false, error: "Could not save the intake submission." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
