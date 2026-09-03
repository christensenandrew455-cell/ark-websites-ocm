import { NextResponse } from "next/server";
import { isStandardRole } from "./accountRoles";
import { getAdminAuth } from "./firebase-admin";

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function requireAuthenticatedCustomer(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!token) {
    return {
      response: NextResponse.json({ error: "Sign in to the client center." }, { status: 401 }),
    };
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(token);
    const clientId = cleanClientId(decodedToken.clientId);
    if (decodedToken.temporaryAccount === true || ["pending_verification", "pending_business_setup", "pending_personalization", "pending_payment"].includes(String(decodedToken.accountStatus || ""))) {
      return {
        response: NextResponse.json({ error: "Complete signup before using the client center." }, { status: 403 }),
      };
    }
    if (!isStandardRole(decodedToken.role) || !clientId) {
      return {
        response: NextResponse.json({ error: "A standard account is required." }, { status: 403 }),
      };
    }
    if (decodedToken.identityVerificationRequired === true && decodedToken.identityVerificationVerified !== true) {
      return {
        response: NextResponse.json({ error: "Verify your email and phone to continue.", code: "ACCOUNT_VERIFICATION_REQUIRED" }, { status: 403 }),
      };
    }
    return { decodedToken, clientId };
  } catch (error) {
    console.error("Unable to verify customer token", error);
    return {
      response: NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 }),
    };
  }
}
