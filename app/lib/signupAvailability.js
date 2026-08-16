import { normalizeClientId, trimmedText } from "./valueUtils.js";
import { accountCollection, pendingSignupCollection } from "./firestoreLayout.js";
import { deletePendingOwnerSignup, pendingOwnerSignupExpired } from "./pendingOwnerSignup.js";

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

export async function checkSignupAvailability({ auth, db, businessName = "", accountEmail, accountPhone, allowedUid = "" }) {
  const email = normalizeSignupEmail(accountEmail);
  const phone = normalizeSignupPhone(accountPhone);
  const businessNameKey = normalizeClientId(businessName);
  const phoneVariants = signupPhoneVariants(phone);
  const accounts = accountCollection(db);
  const pending = pendingSignupCollection(db);
  const [authUser, accountEmailSnapshot, pendingEmailSnapshot, accountPhoneSnapshot, pendingPhoneSnapshot, legacyPendingPhoneSnapshot, businessSnapshot, pendingBusinessSnapshot] = await Promise.all([
    email ? auth.getUserByEmail(email).catch(() => null) : null,
    email ? accounts.where("accountEmail", "==", email).limit(5).get() : null,
    email ? pending.where("account.accountEmail", "==", email).limit(5).get() : null,
    phoneVariants.length ? accounts.where("accountPhone", "in", phoneVariants).limit(5).get() : null,
    phone ? pending.where("account.accountPhone", "==", phone).limit(5).get() : null,
    phone ? pending.where("accountPhoneNormalized", "==", phone).limit(5).get() : null,
    businessNameKey ? accounts.doc(businessNameKey).get() : null,
    businessNameKey ? pending.doc(businessNameKey).get() : null,
  ]);

  const pendingBusinessQuery = pendingBusinessSnapshot?.exists ? { docs: [pendingBusinessSnapshot] } : null;
  const authPendingSnapshot = authUser && authUser.uid !== allowedUid
    ? await pending.where("uid", "==", authUser.uid).limit(1).get()
    : null;
  const expired = await deleteExpiredPendingMatches({ auth, db, snapshots: [pendingEmailSnapshot, pendingPhoneSnapshot, legacyPendingPhoneSnapshot, pendingBusinessQuery, authPendingSnapshot] });
  return {
    email,
    phone,
    businessNameKey,
    businessNameInUse: Boolean(businessSnapshot?.exists && containsDifferentAccount({ docs: [businessSnapshot] }, allowedUid))
      || Boolean(pendingBusinessSnapshot?.exists && containsDifferentAccount({ docs: [pendingBusinessSnapshot] }, allowedUid, expired.deleted)),
    emailInUse: Boolean(authUser && authUser.uid !== allowedUid && !expired.deletedUids.has(authUser.uid))
      || Boolean(accountEmailSnapshot && containsDifferentAccount(accountEmailSnapshot, allowedUid))
      || Boolean(pendingEmailSnapshot && containsDifferentAccount(pendingEmailSnapshot, allowedUid, expired.deleted)),
    phoneInUse: Boolean(accountPhoneSnapshot && containsDifferentAccount(accountPhoneSnapshot, allowedUid))
      || Boolean(pendingPhoneSnapshot && containsDifferentAccount(pendingPhoneSnapshot, allowedUid, expired.deleted))
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
