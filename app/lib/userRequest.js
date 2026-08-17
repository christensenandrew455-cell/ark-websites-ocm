import { NextResponse } from "next/server";
import { isStandardRole } from "./accountRoles";
import { getAdminAuth } from "./firebase-admin";

export async function requireUser(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!token) {
    return {
      response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }),
    };
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(token);
    if (decodedToken.temporaryAccount === true || ["pending_verification", "pending_business_setup", "pending_payment"].includes(String(decodedToken.accountStatus || ""))) {
      return {
        response: NextResponse.json({ error: "Complete signup before using the client center." }, { status: 403 }),
      };
    }
    if (!isStandardRole(decodedToken.role)) {
      return {
        response: NextResponse.json({ error: "A customer owner account is required." }, { status: 403 }),
      };
    }
    if (decodedToken.identityVerificationRequired === true && decodedToken.identityVerificationVerified !== true) {
      return {
        response: NextResponse.json({ error: "Verify your email and phone to continue.", code: "ACCOUNT_VERIFICATION_REQUIRED" }, { status: 403 }),
      };
    }
    return { decodedToken };
  } catch (error) {
    console.error("Unable to verify user token", error);
    return {
      response: NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 }),
    };
  }
}
