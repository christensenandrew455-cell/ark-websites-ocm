import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request) {
  try {
    const { identifier } = await request.json();
    const normalizedIdentifier = String(identifier || "").trim();
    if (!normalizedIdentifier) {
      return NextResponse.json({ error: "Enter your business name." }, { status: 400 });
    }

    let email = normalizedIdentifier.toLowerCase();
    if (!email.includes("@")) {
      const clientId = cleanClientId(normalizedIdentifier);
      const businessSnapshot = await getAdminDb().collection("businesses").doc(clientId).get();
      if (!businessSnapshot.exists) {
        return NextResponse.json({ ok: true });
      }
      email = String(businessSnapshot.data().accountEmail || "").toLowerCase();
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Firebase Authentication is not configured." }, { status: 500 });
    }

    const resetResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
        cache: "no-store",
      }
    );

    if (!resetResponse.ok) {
      const result = await resetResponse.json().catch(() => ({}));
      const code = result?.error?.message || "";
      if (code === "EMAIL_NOT_FOUND") return NextResponse.json({ ok: true });
      console.error("Firebase password reset failed", result);
      return NextResponse.json({ error: "Unable to send the reset email right now." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to send password reset", error);
    return NextResponse.json({ error: "Unable to send the reset email right now." }, { status: 500 });
  }
}
