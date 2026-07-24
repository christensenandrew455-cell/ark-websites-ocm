import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../lib/legal";
import { billingPlanDefinition, normalizeBillingPlan } from "../../../lib/stripeUsageBilling";
import { normalizeClientId, trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeApplicationError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "");
  const message = String(error?.message || error?.errorInfo?.message || "");
  if (code === "auth/email-already-exists") return "That business email is already registered.";
  if (code === "auth/operation-not-allowed") return "Email and password sign-in is not enabled in Firebase.";
  if (/private key|pem|credential|firebase admin/i.test(message)) {
    return "Firebase Admin credentials are invalid. Check the Vercel Firebase variables, then redeploy.";
  }
  return "Unable to submit the account for verification right now.";
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
      billingPlan,
      acceptedTerms,
      acceptedPrivacy,
      termsVersion,
      privacyVersion,
    } = await request.json();

    const business = trimmedText(businessName);
    const owner = trimmedText(ownerName);
    const email = trimmedText(accountEmail).toLowerCase();
    const phone = trimmedText(accountPhone);
    const clientId = normalizeClientId(business);
    const requestedPlan = String(billingPlan || "").trim().toLowerCase();
    if (!new Set(["solo", "solo_pro"]).has(requestedPlan)) {
      return NextResponse.json({ error: "Choose either the Solo or Solo Pro plan." }, { status: 400 });
    }
    const planKey = normalizeBillingPlan(requestedPlan);
    const plan = billingPlanDefinition(planKey);

    if (!clientId || !owner || !email || !phone || typeof password !== "string") {
      return NextResponse.json({ error: "Complete every account field before continuing." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Use a password with at least 8 characters." }, { status: 400 });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid business email address." }, { status: 400 });
    }
    if (acceptedTerms !== true || acceptedPrivacy !== true) {
      return NextResponse.json({ error: "You must agree to the Terms of Use and Privacy Policy before continuing." }, { status: 400 });
    }
    if (termsVersion !== TERMS_VERSION || privacyVersion !== PRIVACY_VERSION) {
      return NextResponse.json({ error: "The legal policies were updated. Refresh the page and review the current versions." }, { status: 409 });
    }

    const auth = getAdminAuth();
    const db = getAdminDb();
    const [existingBusiness, existingUser] = await Promise.all([
      db.collection("businesses").doc(clientId).get(),
      auth.getUserByEmail(email).catch(() => null),
    ]);

    if (existingBusiness.exists) {
      return NextResponse.json({ error: "That business name is already registered or awaiting verification." }, { status: 409 });
    }
    if (existingUser) {
      return NextResponse.json({ error: "That business email is already registered or awaiting verification." }, { status: 409 });
    }

    createdUser = await auth.createUser({
      email,
      password,
      displayName: owner,
      emailVerified: false,
      disabled: false,
    });

    const claims = {
      role: "customer",
      clientId,
      accountStatus: "pending_verification",
      billingPlan: planKey,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
    };
    await auth.setCustomUserClaims(createdUser.uid, claims);

    const acceptedAt = new Date();
    const accountData = {
      uid: createdUser.uid,
      clientId,
      role: "customer",
      businessName: business,
      ownerName: owner,
      accountEmail: email,
      accountPhone: phone,
      billingPlan: planKey,
      billingPlanName: plan.name,
      monthlyBaseCents: plan.monthlyBaseCents,
      includedLeads: plan.includedLeads,
      includedConversations: plan.includedConversations,
      status: "pending_verification",
      verificationStatus: "pending",
      paymentSetupStatus: "awaiting_verification",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion,
      privacyVersion,
      legalAcceptedAt: acceptedAt,
      legalAcceptedBy: email,
      legalAcceptanceSource: "signup-application",
      legalRecordedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (transaction) => {
      const businessRef = db.collection("businesses").doc(clientId);
      const accountRef = db.collection("accounts").doc(createdUser.uid);
      const businessSnapshot = await transaction.get(businessRef);
      if (businessSnapshot.exists) throw new Error("BUSINESS_TAKEN");
      transaction.create(businessRef, accountData);
      transaction.create(accountRef, accountData);
    });

    return NextResponse.json({ ok: true, email, clientId, billingPlan: planKey, status: "pending_verification" });
  } catch (error) {
    console.error("Unable to submit account application", error);
    if (createdUser?.uid) await getAdminAuth().deleteUser(createdUser.uid).catch(() => null);
    if (String(error?.message || "") === "BUSINESS_TAKEN") {
      return NextResponse.json({ error: "That business name is already registered or awaiting verification." }, { status: 409 });
    }
    return NextResponse.json({ error: safeApplicationError(error) }, { status: 500 });
  }
}
