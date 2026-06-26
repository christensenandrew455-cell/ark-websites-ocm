import { NextResponse } from "next/server";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";

const allowedSections = {
  preClients: "preClients",
  preClient: "preClients",
  prospect: "preClients",
  lead: "preClients",
  clients: "clients",
  client: "clients",
  active: "clients",
  postClients: "postClients",
  postClient: "postClients",
  completed: "postClients",
};

function cleanClientId(value) {
  return String(value || "demo-business")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "demo-business";
}

function cleanText(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  try {
    const body = await request.json();

    const clientId = cleanClientId(body.clientId || body.businessId || body.websiteId);
    const sectionKey = allowedSections[body.section] || allowedSections[body.status] || "preClients";

    const newSubmission = {
      Name: cleanText(body.Name || body.name || body.fullName),
      Phone: cleanText(body.Phone || body.phone || body.phoneNumber),
      Email: cleanText(body.Email || body.email),
      Address: cleanText(body.Address || body.address),
      Job: cleanText(body.Job || body.job || body.service || body.projectType),
      Notes: cleanText(body.Notes || body.notes || body.message),
      source: cleanText(body.source || "website-form"),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const hasContactInfo =
      newSubmission.Name ||
      newSubmission.Phone ||
      newSubmission.Email ||
      newSubmission.Notes;

    if (!hasContactInfo) {
      return NextResponse.json(
        { error: "Missing submission info. Send at least name, phone, email, or notes." },
        { status: 400 }
      );
    }

    const documentRef = await addDoc(
      collection(db, "ocmClients", clientId, sectionKey),
      newSubmission
    );

    return NextResponse.json({
      ok: true,
      id: documentRef.id,
      clientId,
      sectionKey,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Could not save submission to Firestore." },
      { status: 500 }
    );
  }
}
