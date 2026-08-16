import { createHash } from "node:crypto";
import { systemCollection } from "./firestoreLayout.js";

function requesterAddress(request) {
  const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || String(request.headers.get("x-real-ip") || "unknown").trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function checkRequestRateLimit({ db, request, scope, limit, windowMs }) {
  const now = Date.now();
  const key = createHash("sha256").update(`${scope}:${requesterAddress(request)}`).digest("hex").slice(0, 48);
  const ref = systemCollection(db, "requestRateLimits").doc(key);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : {};
    const startedAt = toMillis(data.windowStartedAt);
    const activeWindow = startedAt > 0 && now - startedAt < windowMs;
    const count = activeWindow ? Math.max(0, Number(data.count || 0)) : 0;
    if (count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - startedAt)) / 1000)) };
    }
    transaction.set(ref, {
      scope,
      count: count + 1,
      windowStartedAt: new Date(activeWindow ? startedAt : now),
      updatedAt: new Date(now),
    }, { merge: true });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export function rateLimitResponse(result) {
  return Response.json(
    { error: "Too many requests. Wait a few minutes and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
