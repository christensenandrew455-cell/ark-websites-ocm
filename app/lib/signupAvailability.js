import { normalizeClientId, trimmedText } from "./valueUtils.js";
import { accountCollection, pendingSignupCollection } from "./firestoreLayout.js";
import { deletePendingOwnerSignup, pendingOwnerSignupExpired } from "./pendingOwnerSignup.js";
import {
  deleteSignupVerificationRequest,
  signupVerificationRequestCollection,
  signupVerificationRequestExpired,
} from "./signupVerificationRequest.js";

export function normalizeSignupEmail(value) {
  return trimmedText(value).toLowerCase();
}

export function normalizeSignupPhone(value) {
  const digits = trimmedText(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function signupPhoneVariants(value) {
  const normalized = normalizeSignupPhone(value);
  const digits = normalized.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return normalized ? [normalized] : [];
  const area = local.slice(0, 3);
  const prefix = local.slice(3, 6);
  const line = local.slice(6);
  return [...new Set([
    normalized,
    digits,
    local,
    `(${area}) ${prefix}-${line}`,
    `${area}-${prefix}-${line}`,
    `${area}.${prefix}.${line}`,
    `${area} ${prefix} ${line}`,
    `1-${area}-${prefix}-${line}`,
    `+1 ${area} ${prefix} ${line}`,
    `+1 (${area}) ${prefix}-${line}`,
  ])];
}

function documentKey(document) {
  return String(document?.ref?.path || document?.id || "");
}

function containsDifferentAccount(snapshot, allowedUid, ignored = new Set()) {
  return snapshot.docs.some((document) => {
    if (ignored.has(documentKey(document))) return false;
    if (!allowedUid) return true;
    const data = document.data();
    return document.id !== allowedUid
      && String(data.uid || "") !== allowedUid;
  });
}

async function deleteExpiredPendingMatches({ auth, db, snapshots }) {
  const documents = new Map();
  for (const snapshot of snapshots) {
    for (const document of snapshot?.docs || []) documents.set(documentKey(document), document);
  }
  const deleted = new Set();
  const deletedUids = new Set();
  for (const [key, document] of documents) {
    const data = document.data();
    if (!pendingOwnerSignupExpired(data)) continue;
    try {
      await deletePendingOwnerSignup({ db, auth, uid: String(data.uid || "").trim(), pending: { ref: document.ref, data } });
      deleted.add(key);
      if (data.uid) deletedUids.add(String(data.uid));
    } catch (error) {
      console.error(`Unable to remove expired temporary signup ${document.id}`, error);
    }
  }
  return { deleted, deletedUids };
}

async function deleteExpiredVerificationMatches({ auth, db, snapshots }) {
  const documents = new Map();
  for (const snapshot of snapshots) {
    for (const document of snapshot?.docs || []) documents.set(documentKey(document), document);
  }
  const deleted = new Set();
  const deletedUids = new Set();
  for (const [key, document] of documents) {
    const data = document.data();
    if (!signupVerificationRequestExpired(data)) continue;
    try {
      await deleteSignupVerificationRequest({ db, auth, uid: String(data.uid || "").trim(), request: { ref: document.ref, data } });
      deleted.add(key);
      if (data.uid) deletedUids.add(String(data.uid));
    } catch (error) {
      console.error(`Unable to remove expired signup verification request ${document.id}`, error);
    }
  }
  return { deleted, deletedUids };
}

export async function checkSignupAvailability({ auth, db, businessName = "", accountEmail, accountPhone, allowedUid = "" }) {
  const email = normalizeSignupEmail(accountEmail);
  const phone = normalizeSignupPhone(accountPhone);
  const businessNameKey = normalizeClientId(businessName);
  const phoneVariants = signupPhoneVariants(phone);
  const accounts = accountCollection(db);
  const pending = pendingSignupCollection(db);
  const verificationRequests = signupVerificationRequestCollection(db);
  const [authUser, accountEmailSnapshot, pendingEmailSnapshot, requestEmailSnapshot, requestVerificationEmailSnapshot, accountPhoneSnapshot, pendingPhoneSnapshot, requestPhoneSnapshot, requestVerificationPhoneSnapshot, legacyPendingPhoneSnapshot, businessSnapshot, pendingBusinessSnapshot, requestBusinessSnapshot] = await Promise.all([
    email ? auth.getUserByEmail(email).catch(() => null) : null,
    email ? accounts.where("accountEmail", "==", email).limit(5).get() : null,
    email ? pending.where("account.accountEmail", "==", email).limit(5).get() : null,
    email ? verificationRequests.where("account.accountEmail", "==", email).limit(5).get() : null,
    email ? verificationRequests.where("verification.email", "==", email).limit(5).get() : null,
    phoneVariants.length ? accounts.where("accountPhone", "in", phoneVariants).limit(5).get() : null,
    phone ? pending.where("account.accountPhone", "==", phone).limit(5).get() : null,
    phone ? verificationRequests.where("account.accountPhone", "==", phone).limit(5).get() : null,
    phone ? verificationRequests.where("verification.phone", "==", phone).limit(5).get() : null,
    phone ? pending.where("accountPhoneNormalized", "==", phone).limit(5).get() : null,
    businessNameKey ? accounts.doc(businessNameKey).get() : null,
    businessNameKey ? pending.doc(businessNameKey).get() : null,
    businessNameKey ? verificationRequests.doc(businessNameKey).get() : null,
  ]);

  const pendingBusinessQuery = pendingBusinessSnapshot?.exists ? { docs: [pendingBusinessSnapshot] } : null;
  const requestBusinessQuery = requestBusinessSnapshot?.exists ? { docs: [requestBusinessSnapshot] } : null;
  const authPendingSnapshot = authUser && authUser.uid !== allowedUid
    ? await pending.where("uid", "==", authUser.uid).limit(1).get()
    : null;
  const authVerificationSnapshot = authUser && authUser.uid !== allowedUid
    ? await verificationRequests.where("uid", "==", authUser.uid).limit(1).get()
    : null;
  const expired = await deleteExpiredPendingMatches({ auth, db, snapshots: [pendingEmailSnapshot, pendingPhoneSnapshot, legacyPendingPhoneSnapshot, pendingBusinessQuery, authPendingSnapshot] });
  const expiredRequests = await deleteExpiredVerificationMatches({ auth, db, snapshots: [requestEmailSnapshot, requestVerificationEmailSnapshot, requestPhoneSnapshot, requestVerificationPhoneSnapshot, requestBusinessQuery, authVerificationSnapshot] });
  return {
    email,
    phone,
    businessNameKey,
    businessNameInUse: Boolean(businessSnapshot?.exists && containsDifferentAccount({ docs: [businessSnapshot] }, allowedUid))
      || Boolean(pendingBusinessSnapshot?.exists && containsDifferentAccount({ docs: [pendingBusinessSnapshot] }, allowedUid, expired.deleted))
      || Boolean(requestBusinessSnapshot?.exists && containsDifferentAccount({ docs: [requestBusinessSnapshot] }, allowedUid, expiredRequests.deleted)),
    emailInUse: Boolean(authUser && authUser.uid !== allowedUid && !expired.deletedUids.has(authUser.uid) && !expiredRequests.deletedUids.has(authUser.uid))
      || Boolean(accountEmailSnapshot && containsDifferentAccount(accountEmailSnapshot, allowedUid))
      || Boolean(pendingEmailSnapshot && containsDifferentAccount(pendingEmailSnapshot, allowedUid, expired.deleted))
      || Boolean(requestEmailSnapshot && containsDifferentAccount(requestEmailSnapshot, allowedUid, expiredRequests.deleted))
      || Boolean(requestVerificationEmailSnapshot && containsDifferentAccount(requestVerificationEmailSnapshot, allowedUid, expiredRequests.deleted)),
    phoneInUse: Boolean(accountPhoneSnapshot && containsDifferentAccount(accountPhoneSnapshot, allowedUid))
      || Boolean(pendingPhoneSnapshot && containsDifferentAccount(pendingPhoneSnapshot, allowedUid, expired.deleted))
      || Boolean(requestPhoneSnapshot && containsDifferentAccount(requestPhoneSnapshot, allowedUid, expiredRequests.deleted))
      || Boolean(requestVerificationPhoneSnapshot && containsDifferentAccount(requestVerificationPhoneSnapshot, allowedUid, expiredRequests.deleted))
      || Boolean(legacyPendingPhoneSnapshot && containsDifferentAccount(legacyPendingPhoneSnapshot, allowedUid, expired.deleted)),
  };
}

export function signupAvailabilityMessage({ businessNameInUse, emailInUse, phoneInUse }) {
  if (businessNameInUse) return "That business name is already registered. Use a different business name.";
  if (emailInUse && phoneInUse) return "That email address and phone number are already registered.";
  if (emailInUse) return "That email address is already registered.";
  if (phoneInUse) return "That phone number is already registered.";
  return "";
}
