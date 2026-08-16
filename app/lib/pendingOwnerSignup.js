import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { accountCollection, pendingSignupCollection } from "./firestoreLayout.js";

export const PENDING_OWNER_SIGNUP_COLLECTION = "pendingOwnerSignups";
export const PENDING_OWNER_SIGNUP_TTL_MS = 60 * 60 * 1000;

const RETIRED_PENDING_SIGNUP_FIELDS = [
  "moveToRegularAfterPayment",
  "verificationStatus",
  "identityVerificationRequired",
  "identityVerificationVerified",
  "identityVerificationStatus",
  "identityVerificationDeadlineAt",
  "emailVerificationStatus",
  "phoneVerificationStatus",
  "identityVerifiedAt",
  "businessName",
  "businessNameKey",
  "ownerName",
  "accountEmail",
  "accountPhone",
  "accountPhoneNormalized",
  "referrerAccountId",
  "termsAccepted",
  "privacyAccepted",
  "termsVersion",
  "privacyVersion",
  "legalAcceptedAt",
  "businessSetupComplete",
  "timeZone",
  "businessWeekdays",
  "businessStartHour",
  "businessStartPeriod",
  "businessEndHour",
  "businessEndPeriod",
  "businessHours",
  "estimateDays",
  "estimateWeekdays",
  "estimateStartHour",
  "estimateStartPeriod",
  "estimateEndHour",
  "estimateEndPeriod",
  "earliestEstimateStart",
  "latestEstimateStart",
  "businessBase",
  "businessType",
  "serviceAreas",
  "services",
  "businessInformation",
  "extraInformation",
];

function text(value) {
  return String(value || "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function pendingOwnerSignupRef(db, clientId) {
  return pendingSignupCollection(db).doc(text(clientId));
}

export function pendingOwnerSignupExpired(data = {}, now = Date.now()) {
  const expiresAt = asDate(data.expiresAt);
  return !expiresAt || expiresAt.getTime() <= Number(now);
}

export function pendingOwnerSignupAccount(data = {}) {
  const nested = object(data.account);
  if (Object.keys(nested).length) return nested;
  return {
    businessName: text(data.businessName),
    ownerName: text(data.ownerName),
    accountEmail: text(data.accountEmail).toLowerCase(),
    accountPhone: text(data.accountPhoneNormalized || data.accountPhone),
    referrerAccountId: text(data.referrerAccountId),
  };
}

export function pendingOwnerSignupBusiness(data = {}) {
  const nested = object(data.business);
  return Object.keys(nested).length ? nested : data;
}

export function pendingOwnerSignupLegal(data = {}) {
  const nested = object(data.legal);
  if (Object.keys(nested).length) return nested;
  const account = object(data.account);
  return {
    termsAccepted: account.termsAccepted === true || data.termsAccepted === true,
    privacyAccepted: account.privacyAccepted === true || data.privacyAccepted === true,
    termsVersion: text(account.termsVersion || data.termsVersion),
    privacyVersion: text(account.privacyVersion || data.privacyVersion),
    acceptedAt: account.legalAcceptedAt || data.legalAcceptedAt || null,
  };
}

export function pendingOwnerSignupVerified(data = {}) {
  return object(data.verification).verified === true || data.identityVerificationVerified === true;
}

export function retiredPendingOwnerSignupFieldDeletes() {
  return Object.fromEntries(RETIRED_PENDING_SIGNUP_FIELDS.map((field) => [field, FieldValue.delete()]));
}

export async function readPendingOwnerSignup({ db, uid, clientId = "", allowExpired = false }) {
  let snapshot = null;
  if (text(clientId)) {
    snapshot = await pendingOwnerSignupRef(db, clientId).get();
    if (!snapshot.exists) {
      const matches = await pendingSignupCollection(db).where("clientId", "==", text(clientId)).limit(1).get();
      snapshot = matches.empty ? null : matches.docs[0];
    }
  } else if (text(uid)) {
    const matches = await pendingSignupCollection(db).where("uid", "==", text(uid)).limit(1).get();
    snapshot = matches.empty ? null : matches.docs[0];
  }
  if (!snapshot?.exists) return null;
  if (text(uid) && text(snapshot.data().uid) !== text(uid)) return null;
  const data = snapshot.data();
  if (!allowExpired && pendingOwnerSignupExpired(data)) throw new Error("PENDING_SIGNUP_EXPIRED");
  return { ref: snapshot.ref, data };
}

export async function createPendingOwnerSignup({ db, uid, clientId, signup, referrer = null, initialStage = "pending_business_setup" }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PENDING_OWNER_SIGNUP_TTL_MS);
  const stage = initialStage === "pending_verification" ? "pending_verification" : "pending_business_setup";
  const accountPhone = text(signup.accountPhoneNormalized || signup.accountPhone);
  const data = {
    uid,
    clientId,
    stage,
    expiresAt,
    account: {
      businessName: text(signup.businessName),
      ownerName: text(signup.ownerName),
      accountEmail: text(signup.accountEmail).toLowerCase(),
      accountPhone,
      referrerAccountId: text(signup.referrerAccountId),
    },
    legal: {
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: text(signup.termsVersion),
      privacyVersion: text(signup.privacyVersion),
      acceptedAt: now,
    },
    ...(referrer ? { referral: referrer } : {}),
    verification: { verified: stage !== "pending_verification" },
    business: {},
    payment: { status: "not_started" },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const pendingRef = pendingOwnerSignupRef(db, clientId);
  const accounts = accountCollection(db);
  const pending = pendingSignupCollection(db);
  await db.runTransaction(async (transaction) => {
    const [regularName, temporaryName, regularPhone, temporaryPhone, regularEmail, temporaryEmail] = await Promise.all([
      transaction.get(accounts.doc(clientId)),
      transaction.get(pendingRef),
      transaction.get(accounts.where("accountPhone", "==", accountPhone).limit(1)),
      transaction.get(pending.where("account.accountPhone", "==", accountPhone).limit(1)),
      transaction.get(accounts.where("accountEmail", "==", signup.accountEmail).limit(1)),
      transaction.get(pending.where("account.accountEmail", "==", signup.accountEmail).limit(1)),
    ]);
    if (regularName.exists || temporaryName.exists || !regularPhone.empty || !temporaryPhone.empty || !regularEmail.empty || !temporaryEmail.empty) {
      const error = new Error("SIGNUP_IDENTITY_ALREADY_EXISTS");
      error.code = "already-exists";
      throw error;
    }
    transaction.create(pendingRef, data);
  });
  return { ...data, expiresAt };
}

function missingStripeResource(error) {
  return Number(error?.statusCode || error?.status) === 404
    || text(error?.code).toLowerCase() === "resource_missing"
    || text(error?.raw?.code).toLowerCase() === "resource_missing";
}

async function deletePendingStripeCustomer(data = {}) {
  const customerId = text(data.payment?.stripeCustomerId);
  if (!customerId) return;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is required to remove this temporary account's payment data.");
  try {
    await new Stripe(process.env.STRIPE_SECRET_KEY).customers.del(customerId);
  } catch (error) {
    if (!missingStripeResource(error)) throw error;
  }
}

export async function deletePendingOwnerSignup({ db, auth, uid, pending = null }) {
  const safeUid = text(uid);
  const stored = pending
    ? { data: pending.data || pending, ref: pending.ref || null }
    : await readPendingOwnerSignup({ db, uid: safeUid, allowExpired: true });
  const loaded = stored?.data;
  if (!loaded) {
    await auth?.deleteUser(safeUid).catch((error) => {
      if (error?.code !== "auth/user-not-found") throw error;
    });
    return { deleted: false };
  }
  await deletePendingStripeCustomer(loaded);
  if (auth && safeUid) {
    await auth.deleteUser(safeUid).catch((error) => {
      if (error?.code !== "auth/user-not-found") throw error;
    });
  }
  await (stored.ref || pendingOwnerSignupRef(db, loaded.clientId)).delete();
  return { deleted: true };
}

export async function purgeExpiredPendingOwnerSignups({ db, auth, now = new Date(), maximum = 100 } = {}) {
  const snapshot = await pendingSignupCollection(db)
    .where("expiresAt", "<=", now)
    .limit(Math.max(1, maximum))
    .get();
  const result = { checked: snapshot.size, deleted: 0, failed: 0 };
  for (const document of snapshot.docs) {
    const uid = text(document.data().uid || document.id);
    try {
      await deletePendingOwnerSignup({ db, auth, uid, pending: { ref: document.ref, data: document.data() } });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Unable to delete expired temporary signup ${document.id}`, error);
    }
  }
  return result;
}
