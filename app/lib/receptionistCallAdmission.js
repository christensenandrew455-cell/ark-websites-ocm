import { createHash, createHmac } from "node:crypto";
import { systemCollection } from "./firestoreLayout.js";
import { incomingReceptionistCallEvent } from "./receptionistCallNotification.js";

export const CALLER_COOLDOWN_MS = 15 * 60 * 1000;
export const CALL_RECORD_RETENTION_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_DEMO_PHONE_NUMBER = "+17742316164";

function phoneValue(value) {
  if (Array.isArray(value)) return phoneValue(value[0]);
  if (value && typeof value === "object") return value.phone_number || value.number || value.phone || "";
  return value;
}

export function normalizeCallerPhone(value) {
  const raw = String(phoneValue(value) || "").trim().replace(/^tel:/i, "");
  if (!/^\+?[\d\s().-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  if (/^0+$/.test(digits)) return "";
  const normalized = !raw.startsWith("+") && digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : "";
}

export function isDemoCalledPhone(value) {
  return normalizeCallerPhone(value) === normalizeCallerPhone(process.env.DEMO_PHONE_NUMBER || DEFAULT_DEMO_PHONE_NUMBER);
}

function millis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : new Date(value || 0).getTime();
}

function denied(code, error, retryAt = 0, now = Date.now()) {
  return { allowed: false, code, error, retryAfterSeconds: Math.max(0, Math.ceil((retryAt - now) / 1000)) };
}

// Only call after verifying the original Telnyx signature and the destination's setup.
// One caller key spans both numbers. Firestore serializes simultaneous admissions
// across instances; neither a restart nor switching destination resets the timer.
export async function admitReceptionistCall({
  db, body, clientId, now = Date.now(),
  secret = process.env.CALLER_COOLDOWN_SECRET || process.env.FIREBASE_PRIVATE_KEY,
}) {
  const data = body?.data || body || {};
  const payload = data.payload || {};
  const event = incomingReceptionistCallEvent({ body, clientId, now });
  if (!event) return denied("INVALID_CALL_EVENT", "Only incoming call.initiated events can start a receptionist.");
  const caller = normalizeCallerPhone(payload.from || payload.caller_number);
  if (!caller) return denied("CALLER_ID_REQUIRED", "A usable caller number is required.");
  const callId = String(payload.call_control_id || "").trim();
  if (!callId) return denied("CALL_ID_REQUIRED", "The call control ID is required.");
  if (!String(secret || "").trim()) throw new Error("Caller cooldown signing key is not configured.");

  const callerKey = createHmac("sha256", String(secret).replaceAll("\\n", "\n"))
    .update(`ark-caller-cooldown:${caller}`).digest("hex");
  const receiptKey = createHash("sha256").update(callId).digest("hex");
  const callerRef = systemCollection(db, "receptionistCallerCooldowns").doc(callerKey);
  const receiptRef = systemCollection(db, "receptionistCallAdmissions").doc(receiptKey);
  const eventRef = systemCollection(db, "receptionistCallEventOutbox").doc(event.id);

  return db.runTransaction(async (transaction) => {
    const [receiptSnapshot, callerSnapshot] = await Promise.all([
      transaction.get(receiptRef), transaction.get(callerRef),
    ]);
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data();
      if (receipt.allowed && millis(receipt.retryAt) > now) {
        return { allowed: true, duplicate: true, eventId: receipt.eventId, cooldownSeconds: CALLER_COOLDOWN_MS / 1000 };
      }
      return denied("CALL_ALREADY_HANDLED", "This call was already handled.", millis(receipt.retryAt), now);
    }

    const retryAt = millis(callerSnapshot.data()?.expiresAt);
    if (retryAt > now) {
      transaction.set(receiptRef, { allowed: false, retryAt: new Date(retryAt), expiresAt: new Date(now + CALL_RECORD_RETENTION_MS) });
      // A rejected attempt must not push back the original cooldown deadline.
      return denied("CALLER_COOLDOWN", "This caller must wait 15 minutes between calls.", retryAt, now);
    }

    const expiresAt = new Date(now + CALL_RECORD_RETENTION_MS);
    transaction.set(callerRef, { expiresAt: new Date(now + CALLER_COOLDOWN_MS) });
    transaction.set(receiptRef, { allowed: true, eventId: event.id, retryAt: new Date(now + CALLER_COOLDOWN_MS), expiresAt });
    // Commit the alert with admission, before the voice service can answer.
    // No caller identity, intake details, or transcript is retained here.
    transaction.set(eventRef, { event, createdAt: new Date(now), nextAttemptAt: new Date(now), attempts: 0, expiresAt });
    return { allowed: true, duplicate: false, eventId: event.id, cooldownSeconds: CALLER_COOLDOWN_MS / 1000 };
  });
}
