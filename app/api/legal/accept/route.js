import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return { response: NextResponse.json({ error: "Sign in to accept the current policies." }, { status: 401 }) };
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(token);
    return { decodedToken };
  } catch (error) {
    console.error("Unable to verify legal acceptance user", error);
    return { response: NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 }) };
  }
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  try {
    const body = await request.json();
    if (
      body?.acceptedTerms !== true
      || body?.acceptedPrivacy !== true
      || body?.termsVersion !== TERMS_VERSION
      || body?.privacyVersion !== PRIVACY_VERSION
    ) {
      return NextResponse.json({ error: "Accept the current Terms of Use and Privacy Policy." }, { status: 400 });
    }

    const auth = getAdminAuth();
    const db = getAdminDb();
    const uid = user.decodedToken.uid;
    const accountRef = db.collection("accounts").doc(uid);
    const accountSnapshot = await accountRef.get();
    if (!accountSnapshot.exists) {
      return NextResponse.json({ error: "This account record could not be found." }, { status: 404 });
    }

    const account = accountSnapshot.data() || {};
    const clientId = String(user.decodedToken.clientId || account.clientId || "").trim();
    const email = String(user.decodedToken.email || account.accountEmail || "").trim().toLowerCase();
    const acceptance = {
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      legalAcceptedAt: FieldValue.serverTimestamp(),
      legalAcceptedBy: email,
      legalAcceptanceSource: "in-app-policy-gate",
      legalRecordedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(accountRef, acceptance, { merge: true });

    if (clientId) {
      batch.set(db.collection("businesses").doc(clientId), acceptance, { merge: true });
      batch.set(db.collection("ocmClients").doc(clientId), acceptance, { merge: true });
      batch.set(db.collection("ocmClients").doc(clientId).collection("settings").doc("account"), {
        TermsAccepted: true,
        PrivacyAccepted: true,
        TermsVersion: TERMS_VERSION,
        PrivacyVersion: PRIVACY_VERSION,
        LegalAcceptedAt: FieldValue.serverTimestamp(),
        LegalAcceptedBy: email,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();

    const userRecord = await auth.getUser(uid);
    await auth.setCustomUserClaims(uid, {
      ...(userRecord.customClaims || {}),
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    });

    return NextResponse.json({
      accepted: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    });
  } catch (error) {
    console.error("Unable to record legal acceptance", error);
    return NextResponse.json({ error: "The policy acceptance could not be saved. Try again." }, { status: 500 });
  }
}
