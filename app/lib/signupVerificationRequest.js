import { FieldValue } from "firebase-admin/firestore";
import { accountCollection, pendingSignupCollection, systemCollection } from "./firestoreLayout.js";

export const SIGNUP_VERIFICATION_REQUEST_COLLECTION = "signupVerificationRequests";
export const SIGNUP_VERIFICATION_REQUEST_TTL_MS = 60 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function signupVerificationRequestCollection(db) {
  return systemCollection(db, SIGNUP_VERIFICATION_REQUEST_COLLECTION);
}

export function signupVerificationRequestRef(db, clientId) {
  return signupVerificationRequestCollection(db).doc(text(clientId));
}

export function signupVerificationRequestExpired(data = {}, now = Date.now()) {
  const expiresAt = asDate(data.expiresAt);
  return !expiresAt || expiresAt.getTime() <= Number(now);
}

export function signupVerificationRequestAccount(data = {}) {
  const account = data.account && typeof data.account === "object" && !Array.isArray(data.account) ? data.account : {};
  return {
    businessName: text(account.businessName),
    ownerName: text(account.ownerName),
    accountEmail: text(account.accountEmail).toLowerCase(),
    accountPhone: text(account.accountPhone),
  };
}

export function signupVerificationRequestLegal(data = {}) {
  const legal = data.legal && typeof data.legal === "object" && !Array.isArray(data.legal) ? data.legal : {};
  return {
    termsAccepted: legal.termsAccepted === true,
    privacyAccepted: legal.privacyAccepted === true,
    termsVersion: text(legal.termsVersion),
    privacyVersion: text(legal.privacyVersion),
    acceptedAt: legal.acceptedAt || null,
  };
}

export async function readSignupVerificationRequest({ db, uid, clientId = "", allowExpired = false }) {
  let snapshot = null;
  const collection = signupVerificationRequestCollection(db);
  if (text(clientId)) snapshot = await signupVerificationRequestRef(db, clientId).get();
  else if (text(uid)) {
    const matches = await collection.where("uid", "==", text(uid)).limit(1).get();
    snapshot = matches.empty ? null : matches.docs[0];
  }
  if (!snapshot?.exists) return null;
  if (text(uid) && text(snapshot.data().uid) !== text(uid)) return null;
  const data = snapshot.data();
  if (!allowExpired && signupVerificationRequestExpired(data)) throw new Error("SIGNUP_VERIFICATION_EXPIRED");
  return { ref: snapshot.ref, data };
}

export async function createSignupVerificationRequest({ db, uid, clientId, signup }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIGNUP_VERIFICATION_REQUEST_TTL_MS);
  const accountEmail = text(signup.accountEmail).toLowerCase();
  const accountPhone = text(signup.accountPhone);
  const data = {
    uid,
    clientId,
    stage: "pending_verification",
    expiresAt,
    account: {
      businessName: text(signup.businessName),
      ownerName: text(signup.ownerName),
      accountEmail,
      accountPhone,
    },
    legal: {
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: text(signup.termsVersion),
      privacyVersion: text(signup.privacyVersion),
      acceptedAt: now,
    },
    verification: { verified: false },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const requestRef = signupVerificationRequestRef(db, clientId);
  const accounts = accountCollection(db);
  const pending = pendingSignupCollection(db);
  const requests = signupVerificationRequestCollection(db);
  await db.runTransaction(async (transaction) => {
    const [regularName, temporaryName, requestName, regularPhone, temporaryPhone, requestPhone, challengedPhone, regularEmail, temporaryEmail, requestEmail, challengedEmail] = await Promise.all([
      transaction.get(accounts.doc(clientId)),
      transaction.get(pending.doc(clientId)),
      transaction.get(requestRef),
      transaction.get(accounts.where("accountPhone", "==", accountPhone).limit(1)),
      transaction.get(pending.where("account.accountPhone", "==", accountPhone).limit(1)),
      transaction.get(requests.where("account.accountPhone", "==", accountPhone).limit(1)),
      transaction.get(requests.where("verification.phone", "==", accountPhone).limit(1)),
      transaction.get(accounts.where("accountEmail", "==", accountEmail).limit(1)),
      transaction.get(pending.where("account.accountEmail", "==", accountEmail).limit(1)),
      transaction.get(requests.where("account.accountEmail", "==", accountEmail).limit(1)),
      transaction.get(requests.where("verification.email", "==", accountEmail).limit(1)),
    ]);
    if (regularName.exists || temporaryName.exists || requestName.exists
      || !regularPhone.empty || !temporaryPhone.empty || !requestPhone.empty || !challengedPhone.empty
      || !regularEmail.empty || !temporaryEmail.empty || !requestEmail.empty || !challengedEmail.empty) {
      const error = new Error("SIGNUP_IDENTITY_ALREADY_EXISTS");
      error.code = "already-exists";
      throw error;
    }
    transaction.create(requestRef, data);
  });
  return { ...data, expiresAt };
}

export async function deleteSignupVerificationRequest({ db, auth, uid, request = null }) {
  const safeUid = text(uid);
  const stored = request
    ? { data: request.data || request, ref: request.ref || null }
    : await readSignupVerificationRequest({ db, uid: safeUid, allowExpired: true });
  const loaded = stored?.data;
  if (auth && safeUid) {
    await auth.deleteUser(safeUid).catch((error) => {
      if (error?.code !== "auth/user-not-found") throw error;
    });
  }
  if (!loaded) return { deleted: false };
  await (stored.ref || signupVerificationRequestRef(db, loaded.clientId)).delete();
  return { deleted: true };
}

export async function purgeExpiredSignupVerificationRequests({ db, auth, now = new Date(), maximum = 100 } = {}) {
  const snapshot = await signupVerificationRequestCollection(db)
    .where("expiresAt", "<=", now)
    .limit(Math.max(1, maximum))
    .get();
  const result = { checked: snapshot.size, deleted: 0, failed: 0 };
  for (const document of snapshot.docs) {
    const uid = text(document.data().uid);
    try {
      await deleteSignupVerificationRequest({ db, auth, uid, request: { ref: document.ref, data: document.data() } });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Unable to delete expired signup verification request ${document.id}`, error);
    }
  }
  return result;
}
