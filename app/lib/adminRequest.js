import { NextResponse } from "next/server";
import { getAdminAuth } from "./firebase-admin";

export async function requireAdmin(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!token) {
    return {
      response: NextResponse.json({ error: "Sign in as an administrator." }, { status: 401 }),
    };
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(token);
    if (decodedToken.role !== "admin") {
      return {
        response: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }),
      };
    }
    return { decodedToken };
  } catch (error) {
    console.error("Unable to verify administrator token", error);
    return {
      response: NextResponse.json({ error: "Your administrator session has expired. Sign in again." }, { status: 401 }),
    };
  }
}
