import { createHash, timingSafeEqual } from "node:crypto";
import { getAdminDb } from "../../../lib/firebase-admin";
import { trimmedText } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return trimmedText(value);
}

function normalizePhone(value) {
  const digits = text(value).replace(/^tel:/i, "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function secretMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

function authorized(request) {
  const expected = text(process.env.RECEPTIONIST_CONFIG_SECRET);
  const authorization = text(request.headers.get("authorization"));
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const supplied = bearer || text(request.headers.get("x-ark-receptionist-key"));
  return secretMatches(expected, supplied);
}

export async function POST(request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let data = {};
  try {
    data = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Send a JSON lead payload." }, { status: 400 });
  }

  const url = new URL(request.url);
  const phone = normalizePhone(url.searchParams.get("phone") || data.routingPhone || data.receptionistPhone);
  if (!phone) return Response.json({ ok: false, error: "The called phone number is required." }, { status: 400 });

  const db = getAdminDb();
  const connectionSnapshot = await db.collection("connections")
    .where("receptionistPhoneNormalized", "==", phone)
    .limit(2)
    .get();

  if (connectionSnapshot.empty) return Response.json({ ok: false, error: "No AI receptionist is assigned to that phone number." }, { status: 404 });
  if (connectionSnapshot.size > 1) return Response.json({ ok: false, error: "That phone number is assigned more than once." }, { status: 409 });

  const connectionDocument = connectionSnapshot.docs[0];
  const clientId = connectionDocument.id;
  const connection = connectionDocument.data();
  const connectionKey = text(connection.connectionKey);
  if (!connectionKey || connection.enabled === false || connection.receptionistEnabled === false) {
    return Response.json({ ok: false, error: "That AI receptionist connection is not active." }, { status: 403 });
  }

  const intakeUrl = new URL("/api/intake", url.origin);
  intakeUrl.searchParams.set("clientId", clientId);
  intakeUrl.searchParams.set("key", connectionKey);
  intakeUrl.searchParams.set("source", text(connection.sourceLabel || "AI receptionist"));

  const payload = { ...data };
  delete payload.routingPhone;
  delete payload.receptionistPhone;
  delete payload.clientId;
  delete payload.connectionKey;
  delete payload.key;

  const response = await fetch(intakeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ARK-Connection-Key": connectionKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
