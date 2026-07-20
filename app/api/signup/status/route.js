import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request) {
  const header = String(request.headers.get("authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in to view the application status." }, { status: 401 }) };
  try {
    return { decoded: await getAdminAuth().verifyIdToken(token, true) };
  } catch {
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export async function GET(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;

  const snapshot = await getAdminDb().collection("accounts").doc(authorization.decoded.uid).get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: "The account application could not be found." }, { status: 404 });
  }

  const account = snapshot.data();
  return NextResponse.json({
    ok: true,
    status: String(account.status || "pending_verification"),
    verificationStatus: String(account.verificationStatus || "pending"),
    paymentSetupStatus: String(account.paymentSetupStatus || "awaiting_verification"),
    businessName: String(account.businessName || ""),
    ownerName: String(account.ownerName || ""),
    accountEmail: String(account.accountEmail || ""),
    accountPhone: String(account.accountPhone || ""),
    clientId: String(account.clientId || ""),
    submittedAt: iso(account.createdAt),
    verifiedAt: iso(account.verifiedAt),
    declinedAt: iso(account.declinedAt),
  });
}
