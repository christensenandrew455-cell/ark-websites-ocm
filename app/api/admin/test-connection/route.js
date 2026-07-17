import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function appOrigin(request) {
  return text(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const body = await request.json();
    const clientId = text(body.clientId);
    if (!clientId) {
      return NextResponse.json({ error: "Choose a customer first." }, { status: 400 });
    }

    const db = getAdminDb();
    const [businessSnapshot, connectionSnapshot] = await Promise.all([
      db.collection("businesses").doc(clientId).get(),
      db.collection("connections").doc(clientId).get(),
    ]);

    if (!businessSnapshot.exists || !connectionSnapshot.exists) {
      return NextResponse.json({ error: "The customer or connection does not exist." }, { status: 404 });
    }

    const business = businessSnapshot.data();
    const connection = connectionSnapshot.data();
    if (connection.enabled === false) {
      return NextResponse.json({ error: "Enable this connection before testing it." }, { status: 400 });
    }
    if (!text(connection.connectionKey)) {
      return NextResponse.json({ error: "This customer does not have a connection key." }, { status: 400 });
    }

    const now = new Date();
    const testLabel = now.toISOString().replace(/[:.]/g, "-");
    const endpoint = `${appOrigin(request)}/api/intake?clientId=${encodeURIComponent(clientId)}&source=admin-test`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ARK-Connection-Key": text(connection.connectionKey),
      },
      body: JSON.stringify({
        Name: "OCM Test Caller",
        Phone: "555-0100",
        Email: "test@example.com",
        Address: `Connection test ${testLabel}`,
        Job: "Test receptionist intake",
        BestContactMethod: "Call",
        PreferredDay: "Monday",
        PreferredTime: "9:00 AM",
        Notes: `Admin connection test for ${text(business.businessName || clientId)}. Delete this record after confirming it appears.`,
        sectionKey: "contactedMe",
      }),
      cache: "no-store",
    });

    const resultText = await response.text();
    let result = {};
    try {
      result = resultText ? JSON.parse(resultText) : {};
    } catch {
      result = { raw: resultText };
    }

    if (!response.ok) {
      return NextResponse.json({
        error: result.error || `The intake endpoint returned ${response.status}.`,
        status: response.status,
        details: result,
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      message: "The protected intake endpoint accepted the test lead.",
      intake: result,
    });
  } catch (error) {
    console.error("Unable to test customer connection", error);
    return NextResponse.json({ error: "The connection test could not be completed." }, { status: 500 });
  }
}
