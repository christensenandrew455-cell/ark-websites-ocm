import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { accountPhoneRegistryId } from "./signupAvailability.js";

export const PENDING_OWNER_SIGNUP_COLLECTION = "pendingOwnerSignups";
export const PENDING_OWNER_SIGNUP_TTL_MS = 6 * 60 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function pendingOwnerSignupRef(db, uid) {
  return db.collection(PENDING_OWNER_SIGNUP_COLLECTION).doc(text(uid));
}

export function pendingOwnerSignupExpired(data = {}, now = Date.now()) {
  const expiresAt = asDate(data.expiresAt);
  return !expiresAt || expiresAt.getTime() <= Number(now);
}

export async function readPendingOwnerSignup({ db, uid, allowExpired = false }) {
  const ref = pendingOwnerSignupRef(db, uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!allowExpired && pendingOwnerSignupExpired(data)) throw new Error("PENDING_SIGNUP_EXPIRED");
  return { ref, data };
}

export async function createPendingOwnerSignup({ db, uid, clientId, signup, referrer = null }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PENDING_OWNER_SIGNUP_TTL_MS);
  const data = {
    uid,
    clientId,
    stage: "pending_business_setup",
    moveToRegularAfterPayment: true,
    expiresAt,
    account: {
      businessName: signup.businessName,
      ownerName: signup.ownerName,
      accountEmail: signup.accountEmail,
      accountPhone: signup.accountPhone,
      accountPhoneNormalized: signup.accountPhoneNormalized,
      referrerAccountId: signup.referrerAccountId || "",
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: signup.termsVersion,
      privacyVersion: signup.privacyVersion,
      legalAcceptedAt: now,
      ...(referrer ? { referral: referrer } : {}),
    },
    business: {
      businessName: signup.businessName,
      ownerName: signup.ownerName,
      businessEmail: signup.accountEmail,
      businessPhone: signup.accountPhone,
      serviceAreas: [],
      services: {},
      businessInformation: [],
    },
    payment: {
      status: "not_started",
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.create(pendingOwnerSignupRef(db, uid), data);
  batch.create(db.collection("businessNameRegistry").doc(clientId), {
    clientId,
    businessName: signup.businessName,
    ownerUid: uid,
    status: "temporary",
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.create(db.collection("accountPhoneRegistry").doc(accountPhoneRegistryId(signup.accountPhoneNormalized)), {
    uid,
    ownerUid: uid,
    clientId,
    accountPhoneNormalized: signup.accountPhoneNormalized,
    status: "temporary",
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
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

function reservationBelongsTo(snapshot, uid) {
  if (!snapshot?.exists) return false;
  const value = snapshot.data();
  return text(value.uid || value.ownerUid) === uid;
}

export async function deletePendingOwnerSignup({ db, auth, uid, pending = null }) {
  const safeUid = text(uid);
  const loaded = pending || (await readPendingOwnerSignup({ db, uid: safeUid, allowExpired: true }))?.data;
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

  const pendingRef = pendingOwnerSignupRef(db, safeUid);
  const businessRegistryRef = db.collection("businessNameRegistry").doc(text(loaded.clientId));
  const phoneRegistryRef = db.collection("accountPhoneRegistry").doc(accountPhoneRegistryId(loaded.account?.accountPhoneNormalized || loaded.account?.accountPhone));
  await db.runTransaction(async (transaction) => {
    const [businessReservation, phoneReservation] = await Promise.all([
      transaction.get(businessRegistryRef),
      transaction.get(phoneRegistryRef),
    ]);
    transaction.delete(pendingRef);
    transaction.delete(db.collection("accountVerificationChallenges").doc(safeUid));
    if (reservationBelongsTo(businessReservation, safeUid)) transaction.delete(businessRegistryRef);
    if (reservationBelongsTo(phoneReservation, safeUid)) transaction.delete(phoneRegistryRef);
  });
  return { deleted: true };
}

export async function purgeExpiredPendingOwnerSignups({ db, auth, now = new Date(), maximum = 100 } = {}) {
  const snapshot = await db.collection(PENDING_OWNER_SIGNUP_COLLECTION)
    .where("expiresAt", "<=", now)
    .limit(Math.max(1, maximum))
    .get();
  const result = { checked: snapshot.size, deleted: 0, failed: 0 };
  for (const document of snapshot.docs) {
    const uid = text(document.data().uid || document.id);
    try {
      await deletePendingOwnerSignup({ db, auth, uid, pending: document.data() });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Unable to delete expired temporary signup ${document.id}`, error);
    }
  }
  return result;
}
