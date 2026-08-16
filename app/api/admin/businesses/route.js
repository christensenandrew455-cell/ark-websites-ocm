import { NextResponse } from "next/server";
import { ACCOUNT_ROLES } from "../../../lib/accountRoles";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";
import { createPendingOwnerSignup, deletePendingOwnerSignup } from "../../../lib/pendingOwnerSignup";
import { checkSignupAvailability, normalizeSignupPhone, signupAvailabilityMessage } from "../../../lib/signupAvailability";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

function safeCreationError(error) {
  const code = text(error?.code || error?.errorInfo?.code);
  if (code === "auth/email-already-exists") return { status: 409, message: "That login email already has an account." };
  if (code.includes("already-exists")) return { status: 409, message: "That business name or phone number was just registered." };
  return { status: 500, message: "Could not create the temporary customer signup. Check the server logs for details." };
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  let createdUid = "";
  let pendingSaved = false;
  try {
    const body = await request.json().catch(() => ({}));
    const businessName = trimmedText(body.businessName);
    const ownerName = trimmedText(body.ownerName);
    const accountEmail = trimmedText(body.accountEmail).toLowerCase();
    const accountPhone = trimmedText(body.businessPhone);
    const temporaryPassword = String(body.temporaryPassword || "");
    const clientId = normalizeClientId(businessName);
    const accountPhoneNormalized = normalizeSignupPhone(accountPhone);

    if (!businessName || !ownerName || !clientId) return NextResponse.json({ error: "Business name and owner name are required." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return NextResponse.json({ error: "Enter a valid customer login email." }, { status: 400 });
    if (!/^\+1\d{10}$/.test(accountPhoneNormalized)) return NextResponse.json({ error: "Enter a valid 10-digit customer phone number." }, { status: 400 });
    if (temporaryPassword.length < 8) return NextResponse.json({ error: "The temporary password must be at least 8 characters." }, { status: 400 });

    const db = getAdminDb();
    const auth = getAdminAuth();
    const availability = await checkSignupAvailability({ auth, db, businessName, accountEmail, accountPhone });
    const availabilityError = signupAvailabilityMessage(availability);
    if (availabilityError) return NextResponse.json({ error: availabilityError }, { status: 409 });

    const user = await auth.createUser({
      email: accountEmail,
      password: temporaryPassword,
      displayName: ownerName,
      emailVerified: false,
      disabled: false,
    });
    createdUid = user.uid;
    await createPendingOwnerSignup({
      db,
      uid: user.uid,
      clientId,
      signup: {
        businessName,
        ownerName,
        accountEmail,
        accountPhone,
        accountPhoneNormalized,
        referrerAccountId: "",
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    });
    pendingSaved = true;

    const claims = {
      role: ACCOUNT_ROLES.STANDARD,
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      clientId,
      accountStatus: "pending_business_setup",
      temporaryAccount: true,
    };
    await auth.setCustomUserClaims(user.uid, claims);
    return NextResponse.json({
      ok: true,
      clientId,
      businessName,
      accountEmail,
      status: "pending_business_setup",
      expiresInHours: 1,
    }, { status: 201 });
  } catch (error) {
    console.error("Unable to create temporary customer signup", error);
    if (createdUid) {
      const auth = getAdminAuth();
      const rollback = pendingSaved
        ? deletePendingOwnerSignup({ db: getAdminDb(), auth, uid: createdUid })
        : auth.deleteUser(createdUid);
      await rollback.catch((rollbackError) => console.error("Unable to roll back temporary customer signup", rollbackError));
    }
    const safe = safeCreationError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
