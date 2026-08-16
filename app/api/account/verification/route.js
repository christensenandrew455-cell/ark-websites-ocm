import { NextResponse } from "next/server";
import { isStandardRole } from "../../../lib/accountRoles";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { accountRef } from "../../../lib/firestoreLayout";
import { readAccountVerificationStatus, sendAccountVerificationCodes, updateAccountVerificationContact, verifyAccountCodes } from "../../../lib/accountVerification";
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
    const clientId = text(decoded.clientId);
    if (!clientId) return { response: NextResponse.json({ error: "An active owner account in verification is required." }, { status: 403 }) };
    const accountSnapshot = await accountRef(getAdminDb(), clientId).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() : null;
    if (!account || text(account.uid) !== text(decoded.uid) || !isStandardRole(account.role) || account.status !== "active") return { response: NextResponse.json({ error: "An active owner account in verification is required." }, { status: 403 }) };
    return { decoded, account, clientId };
  } catch {
    return { response: NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 }) };
  }
}

function verificationError(error) {
  const message = text(error?.message);
  if (message === "ACCOUNT_EMAIL_INVALID") return { status: 400, error: "Enter a valid email address." };
  if (message === "ACCOUNT_PHONE_INVALID") return { status: 400, error: "Enter a valid 10-digit U.S. phone number." };
  if (message === "EMAIL_TAKEN") return { status: 409, error: "That email address is already registered." };
  if (message === "PHONE_TAKEN") return { status: 409, error: "That phone number is already registered." };
  if (message === "ACCOUNT_ALREADY_VERIFIED") return { status: 409, error: "This account is already verified." };
  if (message === "ACCOUNT_VERIFICATION_EXPIRED") return { status: 410, error: "The one-hour verification window expired. This account is locked and will be deleted. Sign out and start signup again." };
  if (message === "VERIFICATION_RESEND_COOLDOWN") return { status: 429, error: "Please wait before requesting another code.", resendAvailableAt: error.resendAvailableAt?.toISOString?.() || "" };
  if (message === "VERIFICATION_CODE_INVALID") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "Enter both four-digit codes." : "Enter the four-digit email code." };
  if (message === "VERIFICATION_CODE_EXPIRED") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "Those codes expired. Request new codes." : "That code expired. Request a new code." };
  if (message === "VERIFICATION_CODE_INCORRECT") return { status: 400, error: PHONE_VERIFICATION_REQUIRED ? "One or both codes are incorrect." : "That email code is incorrect.", emailCorrect: error.emailCorrect === true, phoneCorrect: error.phoneCorrect === true };
  if (message === "VERIFICATION_TOO_MANY_ATTEMPTS") return { status: 429, error: "Too many incorrect attempts. Request new codes." };
  if (message === "VERIFICATION_CONTACT_CHANGED") return { status: 409, error: "Your email or phone changed. Enter the newest codes." };
  if (message === "VERIFICATION_DELIVERY_FAILED") return { status: 502, error: PHONE_VERIFICATION_REQUIRED ? "One or both codes could not be delivered. Check your connection and try Resend." : "The email code could not be delivered. Check your connection and try Resend.", delivery: error.delivery };
  if (message.startsWith("ACCOUNT_VERIFICATION_NOT_CONFIGURED")) return { status: 503, error: "Account verification is not available right now." };
  return { status: 500, error: "Something went wrong. Reload and try again." };
}

export async function GET(request) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  try {
    return NextResponse.json(await readAccountVerificationStatus({ db: getAdminDb(), uid: authorization.decoded.uid, clientId: authorization.clientId }));
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
    const action = text(body.action).toLowerCase();
    const limits = {
      resend: { scope: "account-verification-resend", limit: 6, windowMs: 60 * 60 * 1000 },
      verify: { scope: "account-verification-check", limit: 10, windowMs: 10 * 60 * 1000 },
      "update-contact": { scope: "account-verification-contact", limit: 4, windowMs: 60 * 60 * 1000 },
    };
    const selectedLimit = limits[action];
    if (!selectedLimit) return NextResponse.json({ error: "Choose a verification action." }, { status: 400 });
    const rateLimit = await checkRequestRateLimit({ db, request, scope: `${selectedLimit.scope}:${authorization.decoded.uid}`, limit: selectedLimit.limit, windowMs: selectedLimit.windowMs });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    if (action === "resend") {
      return NextResponse.json(await sendAccountVerificationCodes({
        db,
        uid: authorization.decoded.uid,
        clientId: authorization.clientId,
        email: text(authorization.account.accountEmail).toLowerCase(),
        phone: text(authorization.account.accountPhone),
      }));
    }
    if (action === "update-contact") {
      return NextResponse.json(await updateAccountVerificationContact({
        db,
        auth: getAdminAuth(),
        uid: authorization.decoded.uid,
        clientId: authorization.clientId,
        email: body.email,
        phone: body.phone,
      }));
    }
    return NextResponse.json(await verifyAccountCodes({
      db,
      auth: getAdminAuth(),
      uid: authorization.decoded.uid,
      clientId: authorization.clientId,
      emailCode: body.emailCode,
      phoneCode: body.phoneCode,
    }));
  } catch (error) {
    console.error("Unable to verify owner account", error);
    const safe = verificationError(error);
    return NextResponse.json(safe, { status: safe.status });
  }
}
