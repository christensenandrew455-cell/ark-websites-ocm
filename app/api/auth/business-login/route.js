import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";

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
    const { identifier, password } = await request.json();
    const normalizedIdentifier = String(identifier || "").trim();

    if (!normalizedIdentifier || !password) {
      return NextResponse.json({ error: "Enter your business name and password." }, { status: 400 });
    }

    const db = getAdminDb();
    let email = normalizedIdentifier.toLowerCase();

    if (!email.includes("@")) {
      const clientId = cleanClientId(normalizedIdentifier);
      const businessSnapshot = await db.collection("businesses").doc(clientId).get();
      if (!businessSnapshot.exists || businessSnapshot.data().status !== "active") {
        return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });
      }
      email = String(businessSnapshot.data().accountEmail || "").toLowerCase();
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Firebase Authentication is not configured." }, { status: 500 });
    }

    const passwordResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
        cache: "no-store",
      }
    );
    const passwordResult = await passwordResponse.json();

    if (!passwordResponse.ok || !passwordResult.localId) {
      return NextResponse.json({ error: "Business name or password is incorrect." }, { status: 401 });
    }

    const auth = getAdminAuth();
    const userRecord = await auth.getUser(passwordResult.localId);
    const accountSnapshot = await db.collection("accounts").doc(userRecord.uid).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : {};
    const isAdmin = getAdminEmails().has(email.toLowerCase());

    if (!isAdmin && (!accountSnapshot.exists || account.status !== "active" || !account.clientId)) {
      return NextResponse.json({ error: "This account is not active." }, { status: 403 });
    }

    const claims = isAdmin
      ? { role: "admin", ...(account.clientId ? { clientId: account.clientId } : {}) }
      : { role: "customer", clientId: account.clientId };

    await auth.setCustomUserClaims(userRecord.uid, claims);

    if (isAdmin) {
      await db.collection("accounts").doc(userRecord.uid).set(
        {
          uid: userRecord.uid,
          accountEmail: email,
          ownerName: account.ownerName || userRecord.displayName || "ARK OCM Admin",
          businessName: account.businessName || "ARK Websites",
          clientId: account.clientId || "",
          role: "admin",
          status: "active",
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }

    const token = await auth.createCustomToken(userRecord.uid, claims);
    return NextResponse.json({ token });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
