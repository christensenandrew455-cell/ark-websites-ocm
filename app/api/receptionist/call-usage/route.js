import { createHash, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCLUDED_MINUTES = 1500;
const ALLOWED_OUTCOMES = new Set([
  "lead-saved",
  "max-duration-no-lead",
  "ended-no-lead",
]);

function text(value) {
  return String(value || "").trim();
}

function cleanClientId(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function secretMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedHash = createHash("sha256").update(String(expected)).digest();
  const providedHash = createHash("sha256").update(String(provided)).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeTimeZone(value) {
  const candidate = text(value) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

function monthKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function numberWithin(value, minimum, maximum, fallback = minimum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

async function authorize(request, data) {
  const url = new URL(request.url);
  const clientId = cleanClientId(data.clientId || url.searchParams.get("clientId"));
  const providedKey = text(
    request.headers.get("x-ark-connection-key")
      || data.connectionKey
      || data.key
      || url.searchParams.get("key")
  );

  if (!clientId || !providedKey) {
    return { response: Response.json({ ok: false, error: "Missing receptionist connection credentials." }, { status: 401 }) };
  }

  const db = getAdminDb();
  const [businessSnapshot, connectionSnapshot] = await Promise.all([
    db.collection("businesses").doc(clientId).get(),
    db.collection("connections").doc(clientId).get(),
  ]);

  if (!businessSnapshot.exists || businessSnapshot.data().status !== "active") {
    return { response: Response.json({ ok: false, error: "That business account is not active." }, { status: 404 }) };
  }

  if (!connectionSnapshot.exists) {
    return { response: Response.json({ ok: false, error: "The receptionist connection is not configured." }, { status: 403 }) };
  }

  const connection = connectionSnapshot.data();
  if (connection.enabled === false || !secretMatches(connection.connectionKey, providedKey)) {
    return { response: Response.json({ ok: false, error: "The receptionist connection is disabled or invalid." }, { status: 403 }) };
  }

  return { db, clientId };
}

export async function POST(request) {
  try {
    const data = await request.json();
    const authorization = await authorize(request, data || {});
    if (authorization.response) return authorization.response;

    const { db, clientId } = authorization;
    const action = text(data.action).toLowerCase();
    if (action !== "record") {
      return Response.json({ ok: false, error: "Unsupported call usage action." }, { status: 400 });
    }

    const callId = text(data.callId);
    if (!callId) {
      return Response.json({ ok: false, error: "A call ID is required." }, { status: 400 });
    }

    const now = Date.now();
    const durationSeconds = Math.ceil(numberWithin(data.durationSeconds, 1, 60 * 60, 1));
    const leadSaved = data.leadSaved === true || String(data.leadSaved).toLowerCase() === "true";
    const requestedOutcome = text(data.outcome).toLowerCase();
    const outcome = ALLOWED_OUTCOMES.has(requestedOutcome)
      ? requestedOutcome
      : leadSaved ? "lead-saved" : "ended-no-lead";
    const endReason = text(data.endReason).slice(0, 80);
    const timeZone = safeTimeZone(data.timeZone);
    const endedAtMs = Number.isFinite(Date.parse(data.endedAt)) ? Date.parse(data.endedAt) : now;
    const startedAtMs = Number.isFinite(Date.parse(data.startedAt))
      ? Math.min(Date.parse(data.startedAt), endedAtMs)
      : Math.max(0, endedAtMs - durationSeconds * 1000);
    const usageMonth = monthKey(new Date(startedAtMs), timeZone);

    const callDocumentId = stableHash(`${clientId}:${callId}`);
    const callRef = db.collection("ocmClients").doc(clientId).collection("receptionistCalls").doc(callDocumentId);
    const currentUsageRef = db.collection("ocmClients").doc(clientId).collection("usage").doc("receptionist-current");
    const monthUsageRef = db.collection("ocmClients").doc(clientId).collection("usage").doc(`receptionist-${usageMonth}`);

    const duplicate = await db.runTransaction(async (transaction) => {
      const [callSnapshot, currentUsageSnapshot, monthUsageSnapshot] = await Promise.all([
        transaction.get(callRef),
        transaction.get(currentUsageRef),
        transaction.get(monthUsageRef),
      ]);

      if (callSnapshot.exists) return true;

      const currentUsage = currentUsageSnapshot.data() || {};
      const sameCurrentMonth = currentUsage.monthKey === usageMonth;
      const nextCurrentSeconds = (sameCurrentMonth ? Number(currentUsage.totalSeconds || 0) : 0) + durationSeconds;
      const nextCurrentCalls = (sameCurrentMonth ? Number(currentUsage.totalCalls || 0) : 0) + 1;

      const monthUsage = monthUsageSnapshot.data() || {};
      const nextMonthSeconds = Number(monthUsage.totalSeconds || 0) + durationSeconds;
      const nextMonthCalls = Number(monthUsage.totalCalls || 0) + 1;

      transaction.create(callRef, {
        callIdHash: stableHash(callId),
        durationSeconds,
        durationMinutes: durationSeconds / 60,
        leadSaved,
        outcome,
        endReason,
        timeZone,
        monthKey: usageMonth,
        startedAt: Timestamp.fromMillis(startedAtMs),
        endedAt: Timestamp.fromMillis(endedAtMs),
        createdAt: FieldValue.serverTimestamp(),
      });

      transaction.set(currentUsageRef, {
        monthKey: usageMonth,
        timeZone,
        includedMinutes: INCLUDED_MINUTES,
        totalSeconds: nextCurrentSeconds,
        totalCalls: nextCurrentCalls,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(monthUsageRef, {
        monthKey: usageMonth,
        timeZone,
        includedMinutes: INCLUDED_MINUTES,
        totalSeconds: nextMonthSeconds,
        totalCalls: nextMonthCalls,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return false;
    });

    return Response.json({
      ok: true,
      duplicate,
      monthKey: usageMonth,
      includedMinutes: INCLUDED_MINUTES,
    });
  } catch (error) {
    console.error("Unable to process receptionist call usage", error);
    return Response.json({ ok: false, error: "Could not process receptionist call usage." }, { status: 500 });
  }
}
