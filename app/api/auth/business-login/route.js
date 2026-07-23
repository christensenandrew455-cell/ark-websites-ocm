import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, getAdminEmails } from "../../../lib/firebase-admin";
import { normalizeClientId } from "../../../lib/valueUtils";

const CUSTOMER_STATUSES = new Set([
  "pending_verification",
  "approved_pending_payment",
  "declined",
  "active",
  "disabled",
]);

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
      const clientId = normalizeClientId(normalizedIdentifier);
      const businessSnapshot = await db.collection("businesses").doc(clientId).get();
      if (!businessSnapshot.exists || !CUSTOMER_STATUSES.has(String(businessSnapshot.data().status || ""))) {
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
    const isAdmin = getAdminEmails().has(email.toLowerCase()) || account.role === "admin";

    if (!isAdmin && (!accountSnapshot.exists || !CUSTOMER_STATUSES.has(String(account.status || "")) || !account.clientId)) {
      return NextResponse.json({ error: "This account is not available." }, { status: 403 });
    }
    if (!isAdmin && account.status === "disabled") {
      return NextResponse.json({ error: "This account is disabled." }, { status: 403 });
    }

    const claims = isAdmin
      ? { role: "admin", accountStatus: "active", ...(account.clientId ? { clientId: account.clientId } : {}) }
      : {
          role: "customer",
          clientId: account.clientId,
          accountStatus: account.status,
          termsAccepted: account.termsAccepted === true,
          privacyAccepted: account.privacyAccepted === true,
          termsVersion: String(account.termsVersion || ""),
          privacyVersion: String(account.privacyVersion || ""),
        };

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
    return NextResponse.json({ token, status: isAdmin ? "active" : account.status });
  } catch (error) {
    console.error("Unable to sign in", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
