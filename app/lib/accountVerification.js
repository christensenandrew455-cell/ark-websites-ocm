import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { ACCOUNT_ROLES } from "./accountRoles";
import { accountVerificationDeadline, accountVerificationExpired } from "./accountVerificationDeadline";
import { accountPrivateRef, accountRef as regularAccountRef } from "./firestoreLayout.js";
import { PHONE_VERIFICATION_REQUIRED } from "./launchFeatures";
import { checkSignupAvailability, normalizeSignupEmail, normalizeSignupPhone } from "./signupAvailability";

export const ACCOUNT_VERIFICATION_TTL_MS = 10 * 60 * 1000;
export const ACCOUNT_VERIFICATION_RESEND_MS = 60 * 1000;
export const ACCOUNT_VERIFICATION_MAX_ATTEMPTS = 5;

function text(value) { return String(value || "").trim(); }
function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function assertAccountVerificationOpen(account) {
  if (["deleting", "retry_pending"].includes(text(account.verificationCleanupStatus)) || accountVerificationExpired(account)) {
    throw new Error("ACCOUNT_VERIFICATION_EXPIRED");
  }
}
function verificationSecret() {
  const value = text(process.env.ACCOUNT_VERIFICATION_SECRET || process.env.SESSION_COOKIE_SECRET || process.env.STRIPE_SECRET_KEY);
  if (!value) throw new Error("ACCOUNT_VERIFICATION_SECRET is required to secure verification codes.");
  return value;
}
function codeHash(uid, channel, code) {
  return createHmac("sha256", verificationSecret()).update(`ark-account-verification-v1:${uid}:${channel}:${code}`).digest("hex");
}
function codeMatches(uid, channel, code, expectedHash) {
  const actual = Buffer.from(codeHash(uid, channel, code), "hex");
  const expected = Buffer.from(text(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function verificationCode() { return String(randomInt(0, 10_000)).padStart(4, "0"); }
function validCode(value) { const code = text(value); return /^\d{4}$/.test(code) ? code : ""; }
function normalizedPhone(value) {
  return normalizeSignupPhone(value);
}
function validContactEmail(value) {
  const email = normalizeSignupEmail(value).slice(0, 254);
  return /^\S+@\S+\.\S+$/.test(email) ? email : "";
}
function validContactPhone(value) {
  const phone = normalizedPhone(value);
  return /^\+1\d{10}$/.test(phone) ? phone : "";
}
function verificationRef(db, clientId) { return accountPrivateRef(db, clientId, "verification"); }
function validEmailSender(value) {
  const sender = text(value);
  const address = sender.match(/<([^<>]+)>$/)?.[1] || sender;
  return /^\S+@\S+\.\S+$/.test(address);
}

export function missingAccountVerificationConfiguration() {
  const values = [
    ["RESEND_API_KEY", text(process.env.RESEND_API_KEY)],
    ["RESEND_FROM_EMAIL", validEmailSender(process.env.RESEND_FROM_EMAIL)],
    ...(PHONE_VERIFICATION_REQUIRED ? [
      ["TELNYX_API_KEY", text(process.env.TELNYX_API_KEY)],
      ["TELNYX_SIGNUP_FROM_NUMBER", /^\+1\d{10}$/.test(normalizedPhone(process.env.TELNYX_SIGNUP_FROM_NUMBER))],
    ] : []),
  ];
  return values.filter(([, configured]) => !configured).map(([name]) => name);
}

async function sendVerificationEmail({ email, code }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${text(process.env.RESEND_API_KEY)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: text(process.env.RESEND_FROM_EMAIL),
      to: [email],
      subject: "Your ARK Client Center verification code",
      text: `Your ARK Client Center email verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
      html: `<p>Your ARK Client Center email verification code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>It expires in 10 minutes. Do not share this code.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend delivery failed (${response.status}).`);
}

async function sendTelnyxText({ phone, message }) {
  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${text(process.env.TELNYX_API_KEY)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: normalizedPhone(process.env.TELNYX_SIGNUP_FROM_NUMBER), to: normalizedPhone(phone), text: message }),
  });
  if (!response.ok) throw new Error(`Telnyx delivery failed (${response.status}).`);
}

export async function sendSignupText({ phone, message }) {
  if (!/^\+1\d{10}$/.test(normalizedPhone(phone))) throw new Error("A valid U.S. mobile phone number is required.");
  await sendTelnyxText({ phone, message });
}

function maskEmail(email) {
  const [name = "", domain = ""] = text(email).split("@");
  return domain ? `${name.slice(0, 1) || "•"}***@${domain}` : "your email";
}
function maskPhone(phone) {
  const digits = normalizedPhone(phone).replace(/\D/g, "");
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "your phone";
}

export function publicAccountVerificationStatus({ account = {}, challenge = {} }) {
  const emailVerified = account.emailVerificationStatus === "verified" || challenge.emailVerified === true;
  const phoneVerified = !PHONE_VERIFICATION_REQUIRED
    || account.phoneVerificationStatus === "verified"
    || account.phoneVerificationStatus === "not_required"
    || challenge.phoneVerified === true;
  const resendAt = asDate(challenge.resendAvailableAt);
  const email = validContactEmail(challenge.email || account.accountEmail) || normalizeSignupEmail(challenge.email || account.accountEmail);
  const phone = validContactPhone(challenge.phone || account.accountPhone) || normalizedPhone(challenge.phone || account.accountPhone);
  const deadline = accountVerificationDeadline(account);
  const accountStatus = text(account.status);
  const nextPath = "/";
  return {
    required: account.identityVerificationRequired === true && account.identityVerificationVerified !== true,
    verified: account.identityVerificationVerified === true || (emailVerified && phoneVerified),
    emailVerified,
    phoneVerified,
    phoneRequired: PHONE_VERIFICATION_REQUIRED,
    email: maskEmail(email),
    phone: PHONE_VERIFICATION_REQUIRED ? maskPhone(phone) : "",
    editableEmail: email,
    editablePhone: phone,
    emailDeliveryStatus: text(challenge.emailDeliveryStatus || "pending"),
    phoneDeliveryStatus: PHONE_VERIFICATION_REQUIRED ? text(challenge.phoneDeliveryStatus || "pending") : "not_required",
    resendAvailableAt: resendAt?.toISOString() || "",
    deadlineAt: deadline?.toISOString() || "",
    expired: accountVerificationExpired(account),
    accountStatus,
    nextPath,
  };
}

export async function readAccountVerificationStatus({ db, uid, clientId }) {
  const [accountSnapshot, challengeSnapshot] = await Promise.all([
    regularAccountRef(db, clientId).get(),
    verificationRef(db, clientId).get(),
  ]);
  if (!accountSnapshot.exists || text(accountSnapshot.data().uid) !== text(uid)) throw new Error("ACCOUNT_NOT_FOUND");
  return publicAccountVerificationStatus({ account: accountSnapshot.data(), challenge: challengeSnapshot.exists ? challengeSnapshot.data() : {} });
}

export async function sendAccountVerificationCodes({ db, uid, clientId, email, phone, ignoreCooldown = false, resetVerification = false }) {
  const missing = missingAccountVerificationConfiguration();
  if (missing.length) throw new Error(`ACCOUNT_VERIFICATION_NOT_CONFIGURED:${missing.join(",")}`);
  const ref = verificationRef(db, clientId);
  const accountRef = regularAccountRef(db, clientId);
  const challengeId = randomUUID();
  const prepared = await db.runTransaction(async (transaction) => {
    const [currentSnapshot, accountSnapshot] = await Promise.all([transaction.get(ref), transaction.get(accountRef)]);
    if (!accountSnapshot.exists || text(accountSnapshot.data().uid) !== text(uid)) throw new Error("ACCOUNT_NOT_FOUND");
    const account = accountSnapshot.data();
    if (account.identityVerificationVerified === true) throw new Error("ACCOUNT_ALREADY_VERIFIED");
    assertAccountVerificationOpen(account);
    const current = currentSnapshot.exists ? currentSnapshot.data() : {};
    const resendAvailableAt = asDate(current.resendAvailableAt);
    if (!ignoreCooldown && resendAvailableAt && resendAvailableAt.getTime() > Date.now() && ["sending", "sent"].includes(text(current.deliveryStatus))) {
      const error = new Error("VERIFICATION_RESEND_COOLDOWN");
      error.resendAvailableAt = resendAvailableAt;
      throw error;
    }
    const targetEmail = validContactEmail(resetVerification ? email : current.email || email);
    const targetPhone = validContactPhone(resetVerification ? phone : current.phone || phone);
    if (!targetEmail) throw new Error("ACCOUNT_EMAIL_INVALID");
    if (!targetPhone) throw new Error("ACCOUNT_PHONE_INVALID");
    const emailCode = !resetVerification && current.emailVerified === true ? "" : verificationCode();
    const phoneCode = PHONE_VERIFICATION_REQUIRED && (resetVerification || current.phoneVerified !== true) ? verificationCode() : "";
    const expiresAt = new Date(Date.now() + ACCOUNT_VERIFICATION_TTL_MS);
    const nextResendAt = new Date(Date.now() + ACCOUNT_VERIFICATION_RESEND_MS);
    transaction.set(ref, {
      uid,
      clientId,
      challengeId,
      email: targetEmail,
      phone: targetPhone,
      ...(emailCode ? { emailCodeHash: codeHash(uid, "email", emailCode), emailVerified: false, emailAttempts: 0, emailDeliveryStatus: "sending" } : {}),
      ...(phoneCode ? { phoneCodeHash: codeHash(uid, "phone", phoneCode), phoneVerified: false, phoneAttempts: 0, phoneDeliveryStatus: "sending" } : {}),
      ...(!PHONE_VERIFICATION_REQUIRED ? { phoneVerified: true, phoneAttempts: 0, phoneDeliveryStatus: "not_required" } : {}),
      deliveryStatus: "sending",
      expiresAt,
      resendAvailableAt: nextResendAt,
      sentAt: FieldValue.serverTimestamp(),
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { emailCode, phoneCode, targetEmail, targetPhone };
  });
  const { emailCode, phoneCode, targetEmail, targetPhone } = prepared;

  const [emailResult, phoneResult] = await Promise.allSettled([
    emailCode ? sendVerificationEmail({ email: targetEmail, code: emailCode }) : Promise.resolve(),
    phoneCode ? sendTelnyxText({ phone: targetPhone, message: `Your ARK Client Center text verification code is ${phoneCode}. It expires in 10 minutes. Do not share this code.` }) : Promise.resolve(),
  ]);
  const emailDeliveryStatus = emailResult.status === "fulfilled" ? "sent" : "failed";
  const phoneDeliveryStatus = PHONE_VERIFICATION_REQUIRED ? (phoneResult.status === "fulfilled" ? "sent" : "failed") : "not_required";
  const deliveryStatus = emailDeliveryStatus === "sent" && (!PHONE_VERIFICATION_REQUIRED || phoneDeliveryStatus === "sent") ? "sent" : "partial";
  await ref.set({ emailDeliveryStatus, phoneDeliveryStatus, deliveryStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (emailResult.status === "rejected" || (PHONE_VERIFICATION_REQUIRED && phoneResult.status === "rejected")) {
    const error = new Error("VERIFICATION_DELIVERY_FAILED");
    error.delivery = { email: emailDeliveryStatus, phone: phoneDeliveryStatus };
    throw error;
  }
  return readAccountVerificationStatus({ db, uid, clientId });
}

export async function updateAccountVerificationContact({ db, auth, uid, clientId, email: rawEmail, phone: rawPhone }) {
  const email = validContactEmail(rawEmail);
  const phone = validContactPhone(rawPhone);
  if (!email) throw new Error("ACCOUNT_EMAIL_INVALID");
  if (!phone) throw new Error("ACCOUNT_PHONE_INVALID");

  const accountSnapshot = await regularAccountRef(db, clientId).get();
  if (!accountSnapshot.exists || text(accountSnapshot.data().uid) !== text(uid)) throw new Error("ACCOUNT_NOT_FOUND");
  const account = accountSnapshot.data();
  if (account.identityVerificationVerified === true) throw new Error("ACCOUNT_ALREADY_VERIFIED");
  assertAccountVerificationOpen(account);

  const availability = await checkSignupAvailability({ auth, db, accountEmail: email, accountPhone: phone, allowedUid: uid });
  if (availability.emailInUse) throw new Error("EMAIL_TAKEN");
  if (availability.phoneInUse) throw new Error("PHONE_TAKEN");

  return sendAccountVerificationCodes({
    db,
    uid,
    clientId: text(account.clientId || clientId),
    email,
    phone,
    ignoreCooldown: true,
    resetVerification: true,
  });
}

export async function verifyAccountCodes({ db, auth, uid, clientId, emailCode: rawEmailCode, phoneCode: rawPhoneCode }) {
  const emailCode = validCode(rawEmailCode);
  const phoneCode = PHONE_VERIFICATION_REQUIRED ? validCode(rawPhoneCode) : "";
  if (!emailCode || (PHONE_VERIFICATION_REQUIRED && !phoneCode)) throw new Error("VERIFICATION_CODE_INVALID");
  const ref = verificationRef(db, clientId);
  const accountRef = regularAccountRef(db, clientId);
  const verification = await db.runTransaction(async (transaction) => {
    const [challengeSnapshot, accountSnapshot] = await Promise.all([transaction.get(ref), transaction.get(accountRef)]);
    if (!accountSnapshot.exists || text(accountSnapshot.data().uid) !== text(uid)) throw new Error("ACCOUNT_NOT_FOUND");
    assertAccountVerificationOpen(accountSnapshot.data());
    if (!challengeSnapshot.exists) throw new Error("VERIFICATION_CODE_EXPIRED");
    const challenge = challengeSnapshot.data();
    const expiresAt = asDate(challenge.expiresAt);
    if (!expiresAt || expiresAt.getTime() <= Date.now()) throw new Error("VERIFICATION_CODE_EXPIRED");
    const emailAttempts = Number(challenge.emailAttempts || 0);
    const phoneAttempts = Number(challenge.phoneAttempts || 0);
    if (emailAttempts >= ACCOUNT_VERIFICATION_MAX_ATTEMPTS || (PHONE_VERIFICATION_REQUIRED && phoneAttempts >= ACCOUNT_VERIFICATION_MAX_ATTEMPTS)) throw new Error("VERIFICATION_TOO_MANY_ATTEMPTS");
    const emailCorrect = challenge.emailVerified === true || codeMatches(uid, "email", emailCode, challenge.emailCodeHash);
    const phoneCorrect = !PHONE_VERIFICATION_REQUIRED || challenge.phoneVerified === true || codeMatches(uid, "phone", phoneCode, challenge.phoneCodeHash);
    transaction.set(ref, {
      emailVerified: emailCorrect,
      phoneVerified: phoneCorrect,
      emailAttempts: emailCorrect ? emailAttempts : emailAttempts + 1,
      phoneAttempts: !PHONE_VERIFICATION_REQUIRED || phoneCorrect ? phoneAttempts : phoneAttempts + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const account = accountSnapshot.data();
    return {
      emailCorrect,
      phoneCorrect,
      challengeId: text(challenge.challengeId),
      clientId: text(account.clientId || challenge.clientId || clientId),
      email: validContactEmail(challenge.email || account.accountEmail),
      phone: validContactPhone(challenge.phone || account.accountPhone),
      previousEmail: validContactEmail(account.accountEmail),
      stripeCustomerId: text(account.stripeCustomerId),
      accountStatus: text(account.status),
    };
  });
  const { emailCorrect, phoneCorrect } = verification;
  if (!emailCorrect || (PHONE_VERIFICATION_REQUIRED && !phoneCorrect)) {
    const error = new Error("VERIFICATION_CODE_INCORRECT");
    error.emailCorrect = emailCorrect;
    error.phoneCorrect = phoneCorrect;
    throw error;
  }

  const { challengeId, clientId: resolvedClientId, email, phone } = verification;
  if (!email) throw new Error("ACCOUNT_EMAIL_INVALID");
  if (!phone) throw new Error("ACCOUNT_PHONE_INVALID");
  const availability = await checkSignupAvailability({ auth, db, accountEmail: email, accountPhone: phone, allowedUid: uid });
  if (availability.emailInUse) throw new Error("EMAIL_TAKEN");
  if (availability.phoneInUse) throw new Error("PHONE_TAKEN");

  const user = await auth.getUser(uid);
  const previousAuthEmail = validContactEmail(user.email || verification.previousEmail);
  const previousAuthEmailVerified = user.emailVerified === true;
  try {
    await auth.updateUser(uid, { email, emailVerified: true });
  } catch (error) {
    if (text(error?.code) === "auth/email-already-exists") throw new Error("EMAIL_TAKEN");
    throw error;
  }

  const nextAccountStatus = verification.accountStatus || "active";
  const verifiedUpdate = {
    status: nextAccountStatus,
    verificationStatus: "verified",
    identityVerificationRequired: false,
    identityVerificationVerified: true,
    identityVerificationStatus: "verified",
    emailVerificationStatus: "verified",
    phoneVerificationStatus: PHONE_VERIFICATION_REQUIRED ? "verified" : "not_required",
    identityVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const contactUpdate = {
    accountEmail: email,
    accountPhone: phone,
    accountPhoneNormalized: phone,
    businessEmail: email,
    businessPhone: phone,
  };

  try {
    await db.runTransaction(async (transaction) => {
      const [latestChallengeSnapshot, latestAccountSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(accountRef),
      ]);
      if (!latestChallengeSnapshot.exists || !latestAccountSnapshot.exists || text(latestAccountSnapshot.data().uid) !== text(uid)) throw new Error("ACCOUNT_NOT_FOUND");
      assertAccountVerificationOpen(latestAccountSnapshot.data());
      const latestChallenge = latestChallengeSnapshot.data();
      if (text(latestChallenge.challengeId) !== challengeId || latestChallenge.emailVerified !== true || (PHONE_VERIFICATION_REQUIRED && latestChallenge.phoneVerified !== true)) {
        throw new Error("VERIFICATION_CONTACT_CHANGED");
      }
      transaction.set(accountRef, { ...contactUpdate, ...verifiedUpdate }, { merge: true });
      transaction.set(ref, {
        ...contactUpdate,
        email,
        phone,
        ...verifiedUpdate,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (error) {
    if (previousAuthEmail) {
      await auth.updateUser(uid, { email: previousAuthEmail, emailVerified: previousAuthEmailVerified }).catch((rollbackError) => {
        console.error("Unable to roll back the account email after verification failed", rollbackError);
      });
    }
    throw error;
  }

  await auth.setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    role: ACCOUNT_ROLES.STANDARD,
    clientId: resolvedClientId,
    accountStatus: nextAccountStatus,
    identityVerificationRequired: false,
    identityVerificationVerified: true,
  });
  if (verification.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    await stripe.customers.update(verification.stripeCustomerId, { email, phone }).catch((error) => {
      console.error("Unable to update the verified Stripe customer contact", error);
    });
  }
  return readAccountVerificationStatus({ db, uid, clientId: resolvedClientId });
}
