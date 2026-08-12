import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ACCOUNT_TYPES } from "../../../lib/accountTypes";
import { requireAdmin } from "../../../lib/adminRequest";
import { deleteCustomerPermanently } from "../../../lib/customerLifecycle";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { qualifyReferralAfterActivation } from "../../../lib/referrals";
import { accountPhoneRegistryId, normalizeSignupPhone } from "../../../lib/signupAvailability";
import { ensureCustomerBillingSubscription } from "../../../lib/stripeUsageBilling";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPLICATION_STATUS = "pending_admin_approval";

function text(value) { return String(value || "").trim(); }

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function localPhoneDigits(value) {
  const normalized = normalizeSignupPhone(value).replace(/\D/g, "");
  return normalized.length === 11 && normalized.startsWith("1") ? normalized.slice(1) : normalized;
}

function areaCode(value) {
  const digits = localPhoneDigits(value);
  return digits.length === 10 ? digits.slice(0, 3) : "";
}

function serviceList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (value && typeof value === "object") return Object.keys(value).map(text).filter(Boolean);
  return [];
}

function applicationPayload(clientId, data, receptionist = {}) {
  return {
    clientId,
    uid: text(data.uid || data.ownerUid),
    businessName: text(data.businessName || clientId),
    ownerName: text(data.ownerName),
    accountEmail: text(data.accountEmail).toLowerCase(),
    accountPhone: text(data.accountPhone),
    accountPhoneNormalized: normalizeSignupPhone(data.accountPhoneNormalized || data.accountPhone),
    requestedAreaCode: areaCode(data.accountPhoneNormalized || data.accountPhone),
    status: text(data.status || APPLICATION_STATUS),
    paymentSetupStatus: text(data.paymentSetupStatus),
    paymentMethodLabel: text(data.paymentMethodLabel),
    termsAccepted: data.termsAccepted === true,
    privacyAccepted: data.privacyAccepted === true,
    legalAcceptedAt: iso(data.legalAcceptedAt),
    submittedAt: iso(data.submittedForApprovalAt || data.createdAt),
    timeZone: text(receptionist.timeZone),
    estimateWeekdays: Array.isArray(receptionist.estimateWeekdays) ? receptionist.estimateWeekdays.map(text).filter(Boolean) : [],
    earliestEstimateStart: text(receptionist.earliestEstimateStart),
    latestEstimateStart: text(receptionist.latestEstimateStart),
    serviceAreas: Array.isArray(receptionist.serviceAreas) ? receptionist.serviceAreas.map(text).filter(Boolean) : [],
    services: serviceList(receptionist.services),
    businessInformation: Array.isArray(receptionist.businessInformation)
      ? receptionist.businessInformation.map((item) => ({ title: text(item?.title), info: text(item?.info) })).filter((item) => item.title && item.info)
      : [],
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  const db = getAdminDb();
  const snapshot = await db.collection("businesses").get();
  const pending = snapshot.docs.filter((document) => text(document.data().status) === APPLICATION_STATUS);
  const receptionistSnapshots = pending.length
    ? await db.getAll(...pending.map((document) => db.collection("ocmClients").doc(document.id).collection("settings").doc("receptionist")))
    : [];
  const applications = pending
    .map((document, index) => applicationPayload(document.id, document.data(), receptionistSnapshots[index]?.exists ? receptionistSnapshots[index].data() : {}))
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return NextResponse.json({ applications });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  try {
    const body = await request.json();
    const clientId = normalizeClientId(body.clientId);
    const action = text(body.action).toLowerCase();
    if (!clientId || !["accept", "decline"].includes(action)) return NextResponse.json({ error: "Choose an application and an approval action." }, { status: 400 });

    const db = getAdminDb();
    const businessRef = db.collection("businesses").doc(clientId);
    const businessSnapshot = await businessRef.get();
    if (!businessSnapshot.exists) return NextResponse.json({ error: "That account application no longer exists." }, { status: 404 });
    const business = businessSnapshot.data();
    if (text(business.status) !== APPLICATION_STATUS) return NextResponse.json({ error: "That account is no longer waiting for approval." }, { status: 409 });
    const uid = text(business.uid || business.ownerUid);
    if (!uid) return NextResponse.json({ error: "That application is missing its account owner." }, { status: 409 });

    if (action === "decline") {
      await deleteCustomerPermanently(clientId);
      return NextResponse.json({ ok: true, deleted: true, clientId });
    }

    const receptionistPhone = text(body.receptionistPhone);
    const receptionistPhoneNormalized = normalizeSignupPhone(receptionistPhone);
    const ownerAreaCode = areaCode(business.accountPhoneNormalized || business.accountPhone);
    const assignedAreaCode = areaCode(receptionistPhoneNormalized);
    if (!/^\+1\d{10}$/.test(receptionistPhoneNormalized)) return NextResponse.json({ error: "Enter a valid 10-digit receptionist number." }, { status: 400 });
    if (!ownerAreaCode || assignedAreaCode !== ownerAreaCode) return NextResponse.json({ error: `Assign a receptionist number with the same ${ownerAreaCode || "customer"} area code as the owner's phone.` }, { status: 400 });
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Billing is not configured, so this account cannot be accepted yet." }, { status: 503 });

    const accountRef = db.collection("accounts").doc(uid);
    const clientRef = db.collection("ocmClients").doc(clientId);
    const connectionRef = db.collection("connections").doc(clientId);
    const receptionistRef = clientRef.collection("settings").doc("receptionist");
    const accountSettingsRef = clientRef.collection("settings").doc("account");
    const connectionRegistryRef = db.collection("connectionPhoneRegistry").doc(accountPhoneRegistryId(receptionistPhoneNormalized));
    const [accountSnapshot, receptionistSnapshot, connectionSnapshot, phoneRegistrySnapshot, duplicatePhoneSnapshot] = await Promise.all([
      accountRef.get(),
      receptionistRef.get(),
      connectionRef.get(),
      connectionRegistryRef.get(),
      db.collection("connections").where("receptionistPhoneNormalized", "==", receptionistPhoneNormalized).limit(2).get(),
    ]);
    if (!accountSnapshot.exists) return NextResponse.json({ error: "That application is missing its owner account." }, { status: 409 });
    if (phoneRegistrySnapshot.exists && text(phoneRegistrySnapshot.data().clientId) !== clientId) return NextResponse.json({ error: "That receptionist number is already assigned to another account." }, { status: 409 });
    if (duplicatePhoneSnapshot.docs.some((document) => document.id !== clientId)) return NextResponse.json({ error: "That receptionist number is already assigned to another account." }, { status: 409 });

    await db.runTransaction(async (transaction) => {
      const latestBusiness = await transaction.get(businessRef);
      if (!latestBusiness.exists || text(latestBusiness.data().status) !== APPLICATION_STATUS) throw new Error("APPLICATION_CHANGED");
      const oldPhoneNormalized = text(latestBusiness.data().approvalReservationPhoneNormalized);
      const oldRegistryRef = oldPhoneNormalized && oldPhoneNormalized !== receptionistPhoneNormalized
        ? db.collection("connectionPhoneRegistry").doc(accountPhoneRegistryId(oldPhoneNormalized))
        : null;
      const [latestRegistry, oldRegistry] = await Promise.all([
        transaction.get(connectionRegistryRef),
        oldRegistryRef ? transaction.get(oldRegistryRef) : Promise.resolve(null),
      ]);
      if (latestRegistry.exists && text(latestRegistry.data().clientId) !== clientId) throw new Error("PHONE_TAKEN");
      if (oldRegistryRef && oldRegistry?.exists && text(oldRegistry.data().clientId) === clientId) transaction.delete(oldRegistryRef);
      transaction.set(connectionRegistryRef, { clientId, receptionistPhone, receptionistPhoneNormalized, status: "reserved", reservedBy: admin.decodedToken.uid, reservedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(businessRef, { approvalReservationPhoneNormalized: receptionistPhoneNormalized, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    const account = accountSnapshot.data();
    const customerId = text(business.stripeCustomerId || account.stripeCustomerId);
    const paymentMethodId = text(business.stripePaymentMethodId || account.stripePaymentMethodId);
    if (!customerId || !paymentMethodId || text(business.paymentSetupStatus || account.paymentSetupStatus) !== "complete") {
      return NextResponse.json({ error: "This application does not have a completed payment method." }, { status: 409 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subscription = await ensureCustomerBillingSubscription({
      stripe,
      db,
      clientId,
      customerId,
      paymentMethodId,
      businessName: text(business.businessName || clientId),
      uid,
      existingSubscriptionId: text(business.stripeSubscriptionId || account.stripeSubscriptionId),
      persist: false,
    });
    if (subscription.status !== "active") return NextResponse.json({ error: "The first account payment was not completed, so the account was not accepted." }, { status: 402 });

    const messagesEnabled = business.messagesEnabled === true;
    const employeesEnabled = business.employeesEnabled === true;
    const employeeMessagingEnabled = messagesEnabled && employeesEnabled && business.employeeMessagingEnabled === true;
    const activeUpdate = {
      status: "active",
      verificationStatus: "approved",
      paymentSetupStatus: "complete",
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: admin.decodedToken.uid,
      approvalReservationPhoneNormalized: FieldValue.delete(),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const connectionKey = text(connectionSnapshot.exists ? connectionSnapshot.data().connectionKey : "") || randomBytes(24).toString("hex");
    const connection = {
      clientId,
      businessName: text(business.businessName || clientId),
      ownerName: text(business.ownerName),
      enabled: true,
      businessPhone: text(business.accountPhone),
      notificationPhone: text(business.accountPhone),
      notificationEmail: text(business.accountEmail).toLowerCase(),
      sourceLabel: text(business.businessName || clientId),
      defaultStage: "contactedMe",
      allowStageOverride: false,
      connectionKey,
      receptionistPhone,
      receptionistPhoneNormalized,
      updatedBy: admin.decodedToken.uid,
      createdAt: connectionSnapshot.exists ? connectionSnapshot.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(accountRef, activeUpdate, { merge: true });
    batch.set(businessRef, activeUpdate, { merge: true });
    batch.set(clientRef, { ...activeUpdate, ownerUid: uid, businessSetupComplete: true }, { merge: true });
    batch.set(connectionRef, connection, { merge: true });
    batch.set(connectionRegistryRef, { clientId, receptionistPhone, receptionistPhoneNormalized, status: "assigned", reservedBy: FieldValue.delete(), assignedBy: admin.decodedToken.uid, assignedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(receptionistRef, { enabled: true, receptionistPhone, receptionistPhoneNormalized, updatedBy: admin.decodedToken.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(accountSettingsRef, {
      BillingStatus: "Active",
      StripeSubscriptionId: subscription.id,
      StripeSubscriptionStatus: subscription.status,
      ReceptionistPhone: receptionistPhone,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (business.signupSessionId) batch.set(db.collection("signupSessions").doc(text(business.signupSessionId)), { status: "active", stripeSubscriptionId: subscription.id, activatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
    if (adminClientId && adminClientId !== clientId) {
      batch.set(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId), {
        Name: text(business.ownerName),
        BusinessName: text(business.businessName || clientId),
        Phone: text(business.accountPhone),
        Email: text(business.accountEmail).toLowerCase(),
        Address: text(business.businessName || clientId),
        PropertyKey: `business-${clientId}`,
        Job: "ARK AI Receptionist account",
        BestContactMethod: business.accountPhone ? "Call" : "Email",
        Notes: `ARK AI Receptionist customer account for ${text(business.businessName || clientId)}.`,
        source: "owner-signup",
        RelatedBusinessClientId: clientId,
        AccountStatus: "active",
        BillingPlan: "standard",
        BillingPlanName: "ARK AI Receptionist",
        TermsAccepted: business.termsAccepted === true,
        PrivacyAccepted: business.privacyAccepted === true,
        TermsVersion: text(business.termsVersion),
        PrivacyVersion: text(business.privacyVersion),
        LegalAcceptedAt: business.legalAcceptedAt || null,
        ContactNames: business.ownerName ? [text(business.ownerName)] : [],
        Phones: business.accountPhone ? [text(business.accountPhone)] : [],
        Emails: business.accountEmail ? [text(business.accountEmail).toLowerCase()] : [],
        currentStage: "clients",
        TotalJobs: 1,
        RepeatJobs: 0,
        createdAt: FieldValue.serverTimestamp(),
        movedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();

    await getAdminAuth().setCustomUserClaims(uid, {
      role: "customer",
      accountType: ACCOUNT_TYPES.OWNER,
      businessRole: "owner",
      clientId,
      accountStatus: "active",
      billingPlan: "standard",
      messagesEnabled,
      employeesEnabled,
      employeeMessagingEnabled,
      termsAccepted: business.termsAccepted === true,
      privacyAccepted: business.privacyAccepted === true,
      termsVersion: text(business.termsVersion),
      privacyVersion: text(business.privacyVersion),
    }).catch((error) => console.error("Unable to refresh accepted owner claims; the next login will retry", error));
    await stripe.customers.update(customerId, { metadata: { uid, clientId, businessName: text(business.businessName || clientId), billingPlan: "standard", accountType: ACCOUNT_TYPES.OWNER, accountStatus: "active" } }).catch((error) => console.error("Unable to update accepted Stripe customer metadata", error));
    const referral = await qualifyReferralAfterActivation({ db, stripe, referredClientId: clientId, referredUid: uid }).catch((error) => {
      console.error("Unable to qualify accepted signup referral; billing sync will retry", error);
      return { status: "pending_activation" };
    });

    const updatedBusiness = await businessRef.get();
    const updatedReceptionist = await receptionistRef.get();
    return NextResponse.json({
      ok: true,
      application: applicationPayload(clientId, updatedBusiness.data(), updatedReceptionist.data()),
      receptionistPhone,
      stripeSubscriptionId: subscription.id,
      referralStatus: referral.status,
    });
  } catch (error) {
    console.error("Unable to update signup application", error);
    if (String(error?.message || "") === "PHONE_TAKEN") return NextResponse.json({ error: "That receptionist number is already assigned to another account." }, { status: 409 });
    if (String(error?.message || "") === "APPLICATION_CHANGED") return NextResponse.json({ error: "That account is no longer waiting for approval." }, { status: 409 });
    return NextResponse.json({ error: "The account could not be accepted right now. Check billing and try again." }, { status: 500 });
  }
}
