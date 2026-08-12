import { normalizeClientId, trimmedText } from "./valueUtils.js";

export function normalizeSignupEmail(value) {
  return trimmedText(value).toLowerCase();
}

export function normalizeSignupPhone(value) {
  const digits = trimmedText(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function accountPhoneRegistryId(value) {
  return normalizeSignupPhone(value).replace(/\D/g, "");
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

function containsDifferentAccount(snapshot, allowedUid) {
  return snapshot.docs.some((document) => {
    if (!allowedUid) return true;
    const data = document.data();
    return document.id !== allowedUid
      && String(data.uid || "") !== allowedUid
      && String(data.ownerUid || "") !== allowedUid;
  });
}

export async function checkSignupAvailability({ auth, db, businessName = "", accountEmail, accountPhone, allowedUid = "" }) {
  const email = normalizeSignupEmail(accountEmail);
  const phone = normalizeSignupPhone(accountPhone);
  const businessNameKey = normalizeClientId(businessName);
  const phoneVariants = signupPhoneVariants(phone);
  const collections = [db.collection("accounts"), db.collection("businesses")];

  const emailQueries = email
    ? collections.map((collection) => collection.where("accountEmail", "==", email).limit(5).get())
    : [];
  const normalizedPhoneQueries = phone
    ? collections.map((collection) => collection.where("accountPhoneNormalized", "==", phone).limit(5).get())
    : [];
  const legacyPhoneQueries = phoneVariants.length
    ? collections.map((collection) => collection.where("accountPhone", "in", phoneVariants).limit(5).get())
    : [];

  const [authUser, emailSnapshots, normalizedPhoneSnapshots, legacyPhoneSnapshots, businessSnapshot, registrySnapshot, phoneRegistrySnapshot] = await Promise.all([
    email ? auth.getUserByEmail(email).catch(() => null) : null,
    Promise.all(emailQueries),
    Promise.all(normalizedPhoneQueries),
    Promise.all(legacyPhoneQueries),
    businessNameKey ? db.collection("businesses").doc(businessNameKey).get() : null,
    businessNameKey ? db.collection("businessNameRegistry").doc(businessNameKey).get() : null,
    phone ? db.collection("accountPhoneRegistry").doc(accountPhoneRegistryId(phone)).get() : null,
  ]);

  return {
    email,
    phone,
    businessNameKey,
    businessNameInUse: [businessSnapshot, registrySnapshot].some((snapshot) => snapshot?.exists && containsDifferentAccount({ docs: [snapshot] }, allowedUid)),
    emailInUse: Boolean(authUser && authUser.uid !== allowedUid)
      || emailSnapshots.some((snapshot) => containsDifferentAccount(snapshot, allowedUid)),
    phoneInUse: normalizedPhoneSnapshots.some((snapshot) => containsDifferentAccount(snapshot, allowedUid))
      || legacyPhoneSnapshots.some((snapshot) => containsDifferentAccount(snapshot, allowedUid))
      || Boolean(phoneRegistrySnapshot?.exists && containsDifferentAccount({ docs: [phoneRegistrySnapshot] }, allowedUid)),
  };
}

export function signupAvailabilityMessage({ businessNameInUse, emailInUse, phoneInUse }) {
  if (businessNameInUse) return "That business name is already registered. Use a different business name.";
  if (emailInUse && phoneInUse) return "That email address and phone number are already registered.";
  if (emailInUse) return "That email address is already registered.";
  if (phoneInUse) return "That phone number is already registered.";
  return "";
}
