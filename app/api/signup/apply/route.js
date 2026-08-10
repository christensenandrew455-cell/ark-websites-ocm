import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ACCOUNT_TYPES, normalizePersonKey } from "../../../lib/accountTypes";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import {
  BILLING_VERSION,
  MESSAGE_PARTS_PER_BUNDLE,
  MONTHLY_BASE_CENTS,
  PER_CALL_CENTS,
  PER_CHAT_CENTS,
  PER_EMPLOYEE_CENTS,
  PER_MESSAGE_BUNDLE_CENTS,
} from "../../../lib/stripeUsageBilling";
import { pendingReferralFields, validateReferrerAccount } from "../../../lib/referrals";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeApplicationError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "");
  const message = String(error?.message || error?.errorInfo?.message || "");
  if (code === "auth/email-already-exists") return "That email address is already registered.";
  if (code === "auth/operation-not-allowed") return "Email and password sign-in is not enabled in Firebase.";
  if (/private key|pem|credential|firebase admin/i.test(message)) return "Firebase Admin credentials are invalid. Check the Vercel Firebase variables, then redeploy.";
  return "Unable to create the account right now.";
}

export async function POST(request) {
  let createdUser = null;
  try {
    const {
      businessName,
      ownerName,
      accountEmail,
      accountPhone,
      password,
      acceptedTerms,
      acceptedPrivacy,
      termsVersion,
      privacyVersion,
      referrerAccountId,
    } = await request.json();

    const business = trimmedText(businessName);
    const owner = trimmedText(ownerName);
    const email = trimmedText(accountEmail).toLowerCase();
    const phone = trimmedText(accountPhone);
    const clientId = normalizeClientId(business);
    const ownerNameKey = normalizePersonKey(owner);

    if (!clientId || !ownerNameKey || !email || !phone || typeof password !== "string") return NextResponse.json({ error: "Complete every account field before continuing." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Use a password with at least 8 characters." }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (acceptedTerms !== true || acceptedPrivacy !== true) return NextResponse.json({ error: "You must agree to the Terms of Use and Privacy Policy before continuing." }, { status: 400 });
    if (termsVersion !== TERMS_VERSION || privacyVersion !== PRIVACY_VERSION) return NextResponse.json({ error: "The legal policies were updated. Refresh the page and review the current versions." }, { status: 409 });

    const auth = getAdminAuth();
    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({ db, request, scope: "owner-signup", limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
    const businessRef = db.collection("businesses").doc(clientId);
    const registryRef = db.collection("businessNameRegistry").doc(clientId);
    const [existingBusiness, existingRegistry, existingUser] = await Promise.all([
      businessRef.get(),
      registryRef.get(),
      auth.getUserByEmail(email).catch(() => null),
    ]);

    if (existingBusiness.exists || (existingRegistry.exists && existingRegistry.data().clientId !== clientId)) return NextResponse.json({ error: "That business name is already registered. Use a different business name." }, { status: 409 });
    if (existingUser) return NextResponse.json({ error: "That email address is already registered." }, { status: 409 });
    const referrer = await validateReferrerAccount({ db, referrerAccountId, referredClientId: clientId });

    createdUser = await auth.createUser({ email, password, displayName: owner, emailVerified: false, disabled: false });
    const claims = {
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      clientId,
      accountStatus: "approved_pending_payment",
      billingPlan: "standard",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
    };
    await auth.setCustomUserClaims(createdUser.uid, claims);

    const acceptedAt = new Date();
    const accountData = {
      uid: createdUser.uid,
      ownerUid: createdUser.uid,
      clientId,
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      businessName: business,
      businessNameKey: clientId,
      ownerName: owner,
      ownerNameKey,
      accountEmail: email,
      accountPhone: phone,
      billingPlan: "standard",
      billingPlanName: "ARK AI Receptionist",
      billingVersion: BILLING_VERSION,
      monthlyBaseCents: MONTHLY_BASE_CENTS,
      perCallCents: PER_CALL_CENTS,
      perChatCents: PER_CHAT_CENTS,
      perMessageBundleCents: PER_MESSAGE_BUNDLE_CENTS,
      messagePartsPerBundle: MESSAGE_PARTS_PER_BUNDLE,
      perEmployeeCents: PER_EMPLOYEE_CENTS,
      includedLeads: 0,
      includedConversations: 0,
      includedEmployees: 0,
      messagesEnabled: false,
      employeesEnabled: false,
      employeeMessagingEnabled: false,
      ...pendingReferralFields(referrer),
      status: "approved_pending_payment",
      verificationStatus: "not_required",
      paymentSetupStatus: "ready",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
      legalAcceptedAt: acceptedAt,
      legalAcceptedBy: email,
      legalAcceptanceSource: "owner-signup",
      legalRecordedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (transaction) => {
      const [businessSnapshot, registrySnapshot] = await Promise.all([transaction.get(businessRef), transaction.get(registryRef)]);
      if (businessSnapshot.exists || (registrySnapshot.exists && registrySnapshot.data().clientId !== clientId)) throw new Error("BUSINESS_TAKEN");
      transaction.create(businessRef, accountData);
      transaction.create(db.collection("accounts").doc(createdUser.uid), accountData);
      transaction.set(registryRef, {
        clientId,
        businessName: business,
        ownerUid: createdUser.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true, email, clientId, accountType: ACCOUNT_TYPES.OWNER, billingPlan: "standard", status: "approved_pending_payment", referralStatus: referrer.referrerClientId ? "pending_activation" : "none" });
  } catch (error) {
    console.error("Unable to create owner account", error);
    if (createdUser?.uid) await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    if (String(error?.message || "") === "BUSINESS_TAKEN") return NextResponse.json({ error: "That business name is already registered. Use a different business name." }, { status: 409 });
    if (String(error?.message || "") === "SELF_REFERRAL") return NextResponse.json({ error: "A business cannot refer its own account." }, { status: 400 });
    if (String(error?.message || "") === "REFERRER_NOT_FOUND") return NextResponse.json({ error: "That referral account ID is not an active ARK account." }, { status: 400 });
    return NextResponse.json({ error: safeApplicationError(error) }, { status: 500 });
  }
}
