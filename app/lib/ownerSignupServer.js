import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ownerSignupDigestInput } from "./ownerSignup.js";

function digestSecret() {
  const secret = String(process.env.STRIPE_SECRET_KEY || "");
  if (!secret) throw new Error("STRIPE_SECRET_KEY is required to secure signup details.");
  return secret;
}

export function ownerSignupDigest(value) {
  return createHmac("sha256", digestSecret()).update(ownerSignupDigestInput(value)).digest("hex");
}

export function ownerSignupDigestMatches(value, expected) {
  const actualBuffer = Buffer.from(ownerSignupDigest(value), "hex");
  const expectedBuffer = Buffer.from(String(expected || ""), "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function ownerSignupUid(sessionId) {
  return `ark_owner_${createHash("sha256").update(String(sessionId || "")).digest("hex").slice(0, 28)}`;
}
