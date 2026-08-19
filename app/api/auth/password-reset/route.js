import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { accountRef } from "../../../lib/firestoreLayout";
import { deletePendingOwnerSignup, pendingOwnerSignupExpired, readPendingOwnerSignup } from "../../../lib/pendingOwnerSignup";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import {
  deleteSignupVerificationRequest,
  readSignupVerificationRequest,
  signupVerificationRequestAccount,
  signupVerificationRequestExpired,
} from "../../../lib/signupVerificationRequest";

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

    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({ db, request, scope: "password-reset", limit: 5, windowMs: 15 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    let email = normalizedIdentifier.toLowerCase();
    if (!email.includes("@")) {
      const clientId = cleanClientId(normalizedIdentifier);
      const [accountSnapshot, pending, verificationRequest] = await Promise.all([
        accountRef(db, clientId).get(),
        readPendingOwnerSignup({ db, clientId, allowExpired: true }),
        readSignupVerificationRequest({ db, clientId, allowExpired: true }),
      ]);
      if (accountSnapshot.exists) email = String(accountSnapshot.data().accountEmail || "").toLowerCase();
      else if (pending && !pendingOwnerSignupExpired(pending.data)) email = String(pending.data.accountEmail || pending.data.account?.accountEmail || "").toLowerCase();
      else if (verificationRequest && !signupVerificationRequestExpired(verificationRequest.data)) email = signupVerificationRequestAccount(verificationRequest.data).accountEmail;
      else {
        if (pending) await deletePendingOwnerSignup({ db, auth: getAdminAuth(), uid: pending.data.uid, pending }).catch((error) => console.error("Unable to remove expired temporary signup during password reset", error));
        if (verificationRequest) await deleteSignupVerificationRequest({ db, auth: getAdminAuth(), uid: verificationRequest.data.uid, request: verificationRequest }).catch((error) => console.error("Unable to remove expired signup verification request during password reset", error));
        return NextResponse.json({ ok: true });
      }
    }

    if (!email) return NextResponse.json({ ok: true });

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Unable to send the reset email right now." }, { status: 500 });
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
