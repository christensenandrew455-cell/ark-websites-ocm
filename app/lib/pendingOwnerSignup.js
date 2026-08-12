import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { OWNER_SIGNUP_DRAFT_MAX_AGE_MS, normalizeOwnerSignup } from "./ownerSignup.js";
import { ownerSignupDigest, ownerSignupDigestMatches } from "./ownerSignupServer.js";

const COLLECTION = "pendingOwnerSignups";
const VERSION = 1;
const ENCRYPTION_CONTEXT = "ark-owner-signup-encryption-v1";
const HANDOFF_CONTEXT = "ark-owner-signup-handoff-v1";

function secret() {
  const value = String(process.env.STRIPE_SECRET_KEY || "");
  if (!value) throw new Error("STRIPE_SECRET_KEY is required to protect pending signup details.");
  return value;
}

function validSessionId(value) {
  const sessionId = String(value || "").trim();
  return sessionId && sessionId.length <= 255 && !sessionId.includes("/") ? sessionId : "";
}

function encryptionKey() {
  return createHmac("sha256", secret()).update(ENCRYPTION_CONTEXT).digest();
}

function aad({ sessionId, signupDigest, stripeCustomerId }) {
  return Buffer.from(JSON.stringify({ version: VERSION, sessionId, signupDigest, stripeCustomerId }), "utf8");
}

export function pendingOwnerSignupHandoffHash(handoff) {
  return createHmac("sha256", secret()).update(HANDOFF_CONTEXT).update(":").update(String(handoff || "")).digest("hex");
}

export function pendingOwnerSignupHandoffMatches(handoff, expectedHash) {
  const actual = Buffer.from(pendingOwnerSignupHandoffHash(handoff), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sealPendingOwnerSignup({ sessionId: rawSessionId, signup: rawSignup, stripeCustomerId = "" }) {
  const sessionId = validSessionId(rawSessionId);
  if (!sessionId) throw new Error("A valid Stripe session ID is required.");
  const signup = normalizeOwnerSignup(rawSignup, { includePassword: true });
  const signupDigest = ownerSignupDigest(signup);
  const iv = randomBytes(12);
  const metadata = { sessionId, signupDigest, stripeCustomerId: String(stripeCustomerId || "").trim() };
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad(metadata));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(signup), "utf8"), cipher.final()]);
  return {
    version: VERSION,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ...metadata,
  };
}

export function openPendingOwnerSignup(sealed) {
  if (Number(sealed?.version) !== VERSION || sealed?.algorithm !== "aes-256-gcm") throw new Error("The pending signup format is not supported.");
  const metadata = {
    sessionId: validSessionId(sealed.sessionId),
    signupDigest: String(sealed.signupDigest || ""),
    stripeCustomerId: String(sealed.stripeCustomerId || "").trim(),
  };
  if (!metadata.sessionId || !metadata.signupDigest) throw new Error("The pending signup is incomplete.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(String(sealed.iv || ""), "base64"));
  decipher.setAAD(aad(metadata));
  decipher.setAuthTag(Buffer.from(String(sealed.tag || ""), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(sealed.ciphertext || ""), "base64")),
    decipher.final(),
  ]).toString("utf8");
  const signup = normalizeOwnerSignup(JSON.parse(plaintext), { includePassword: true });
  if (!ownerSignupDigestMatches(signup, metadata.signupDigest)) throw new Error("The pending signup did not pass its integrity check.");
  return signup;
}

export async function savePendingOwnerSignup({ db, sessionId, signup, stripeCustomerId, handoff }) {
  const sealed = sealPendingOwnerSignup({ sessionId, signup, stripeCustomerId });
  const expiresAt = new Date(Date.now() + OWNER_SIGNUP_DRAFT_MAX_AGE_MS);
  await db.collection(COLLECTION).doc(sealed.sessionId).set({
    sealed,
    signupDigest: sealed.signupDigest,
    stripeCustomerId: sealed.stripeCustomerId,
    handoffHash: pendingOwnerSignupHandoffHash(handoff),
    status: "awaiting_payment",
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { signupDigest: sealed.signupDigest, expiresAt };
}

export async function loadPendingOwnerSignup({ db, sessionId: rawSessionId, handoff }) {
  const sessionId = validSessionId(rawSessionId);
  if (!sessionId) return null;
  const snapshot = await db.collection(COLLECTION).doc(sessionId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  const expiry = data.expiresAt?.toDate?.() || new Date(data.expiresAt || 0);
  if (!expiry.getTime() || expiry.getTime() <= Date.now()) {
    await snapshot.ref.delete().catch(() => null);
    return null;
  }
  if (!pendingOwnerSignupHandoffMatches(handoff, data.handoffHash)) throw new Error("SIGNUP_HANDOFF_INVALID");
  const signup = openPendingOwnerSignup(data.sealed);
  return {
    signup,
    signupDigest: String(data.signupDigest || ""),
    stripeCustomerId: String(data.stripeCustomerId || ""),
    handoffHash: String(data.handoffHash || ""),
  };
}

export async function deletePendingOwnerSignup({ db, sessionId }) {
  const validId = validSessionId(sessionId);
  if (validId) await db.collection(COLLECTION).doc(validId).delete().catch(() => null);
}

export async function purgeExpiredPendingOwnerSignups({ db, maximum = 500 }) {
  let removed = 0;
  while (removed < maximum) {
    const limit = Math.min(100, maximum - removed);
    const snapshot = await db.collection(COLLECTION).where("expiresAt", "<=", new Date()).limit(limit).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    removed += snapshot.size;
    if (snapshot.size < limit) break;
  }
  return removed;
}
