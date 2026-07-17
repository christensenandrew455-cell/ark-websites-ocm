import { NextResponse } from "next/server";
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
    return { decodedToken };
  } catch (error) {
    console.error("Unable to verify user token", error);
    return {
      response: NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 }),
    };
  }
}
