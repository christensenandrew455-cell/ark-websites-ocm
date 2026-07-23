import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (text(body.companyWebsite, 200)) return NextResponse.json({ ok: true }, { status: 201 });

    const name = text(body.name, 120);
    const businessName = text(body.businessName, 160);
    const email = text(body.email, 254).toLowerCase();
    const subject = text(body.subject, 180);
    const message = text(body.message, 4000);

    if (!name || !businessName || !email || message.length < 10) {
      return NextResponse.json({ error: "Complete your name, business, email, and support message." }, { status: 400 });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("supportRequests").doc();
    await ref.set({
      clientId: "public-support",
      businessName,
      ownerName: name,
      accountEmail: email,
      type: "help",
      subject: subject || "Public support request",
      message,
      status: "new",
      priority: "normal",
      source: "public-support-page",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
  } catch (error) {
    console.error("Unable to submit public support request", error);
    return NextResponse.json({ error: "Support could not be contacted right now. Please try again." }, { status: 500 });
  }
}
