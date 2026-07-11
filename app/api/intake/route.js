import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";

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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function buildRow(data) {
  return {
    Name: text(data.Name || data.name || data.fullName || data.customerName),
    Phone: text(data.Phone || data.phone || data.phoneNumber || data.contact),
    Email: text(data.Email || data.email),
    Address: text(data.Address || data.address || data.customerAddress),
    Job: text(data.Job || data.job || data.service || data.projectType || data.requestedService),
    PreferredDay: text(data.PreferredDay || data.preferredDay || data.estimateDay),
    PreferredTime: text(data.PreferredTime || data.preferredTime || data.estimateTime),
    Notes: text(data.Notes || data.notes || data.message || data.summary),
    source: text(data.source || "website"),
    rawSubmission: data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
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

    const documentRef = await addDoc(collection(db, "ocmClients", clientId, sectionKey), row);

    return Response.json(
      { ok: true, id: documentRef.id, clientId, sectionKey },
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
