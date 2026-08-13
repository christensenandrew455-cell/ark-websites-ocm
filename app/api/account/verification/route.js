import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { readAccountVerificationStatus, sendAccountVerificationCodes, verifyAccountCodes } from "../../../lib/accountVerification";
import { PHONE_VERIFICATION_REQUIRED } from "../../../lib/launchFeatures";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

async function authorize(request) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in to verify your account." }, { status: 401 }) };
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    const accountSnapshot = await getAdminDb().collection("accounts").doc(decoded.uid).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : null;
    if (!account || account.role !== "customer" || account.status !== "active") return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
    return { decoded, account };
  } catch {
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
}

function verificationError(error) {
  const message = text(error?.message);
  if (message === "VERIFICATION_RESEND_COOLDOWN") return { status: 429, error: "Please wait before requesting another code.", resendAvailableAt: error.resendAvailableAt?.toISOString?.() || "" };
  if (message === "VERIFICATION_CODE_INVALID") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "Enter both four-digit codes." : "Enter the four-digit email code." };
  if (message === "VERIFICATION_CODE_EXPIRED") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "Those codes expired. Request new codes." : "That code expired. Request a new code." };
  if (message === "VERIFICATION_CODE_INCORRECT") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "One or both codes are incorrect." : "That email code is incorrect.", emailCorrect: error.emailCorrect === true, phoneCorrect: error.phoneCorrect === true };
  if (message === "VERIFICATION_TOO_MANY_ATTEMPTS") return { status: 429, error: "Too many incorrect attempts. Request new codes." };
  if (message === "VERIFICATION_DELIVERY_FAILED") return { status: 502, error: PHONE_VERIFICATION_REQUIRED ? "One or both codes could not be delivered. Check your connection and try Resend." : "The email code could not be delivered. Check your connection and try Resend.", delivery: error.delivery };
  if (message.startsWith("ACCOUNT_VERIFICATION_NOT_CONFIGURED")) return { status: 503, error: "Account verification is not available right now." };
  return { status: 500, error: "Something went wrong. Reload and try again." };
}

export async function GET(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  try {
    return NextResponse.json(await readAccountVerificationStatus({ db: getAdminDb(), uid: authorization.decoded.uid }));
  } catch (error) {
    const safe = verificationError(error);
    return NextResponse.json(safe, { status: safe.status });
  }
}

export async function POST(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  try {
    const body = await request.json().catch(() => ({}));
    const db = getAdminDb();
    const scope = text(body.action).toLowerCase() === "resend" ? "account-verification-resend" : "account-verification-check";
    const rateLimit = await checkRequestRateLimit({ db, request, scope: `${scope}:${authorization.decoded.uid}`, limit: scope.endsWith("resend") ? 6 : 10, windowMs: scope.endsWith("resend") ? 60 * 60 * 1000 : 10 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    if (text(body.action).toLowerCase() === "resend") {
      return NextResponse.json(await sendAccountVerificationCodes({
        db,
        uid: authorization.decoded.uid,
        clientId: text(authorization.account.clientId),
        email: text(authorization.account.accountEmail).toLowerCase(),
        phone: text(authorization.account.accountPhone),
      }));
    }
    if (text(body.action).toLowerCase() !== "verify") return NextResponse.json({ error: "Choose a verification action." }, { status: 400 });
    return NextResponse.json(await verifyAccountCodes({
      db,
      auth: getAdminAuth(),
      uid: authorization.decoded.uid,
      emailCode: body.emailCode,
      phoneCode: body.phoneCode,
    }));
  } catch (error) {
    console.error("Unable to verify owner account", error);
    const safe = verificationError(error);
    return NextResponse.json(safe, { status: safe.status });
  }
}
