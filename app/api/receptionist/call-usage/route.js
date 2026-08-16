import { createHash, timingSafeEqual } from "node:crypto";
import { billingLeadEventId } from "../../../lib/billingLeadUsage";
import { getAdminDb } from "../../../lib/firebase-admin";
import { recordLeadUsage } from "../../../lib/usageThresholdBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function cleanClientId(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function secretMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedHash = createHash("sha256").update(String(expected)).digest();
  const providedHash = createHash("sha256").update(String(provided)).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

async function authorize(request, data) {
  const url = new URL(request.url);
  const clientId = cleanClientId(data.clientId || url.searchParams.get("clientId"));
  const providedKey = text(request.headers.get("x-ark-connection-key") || data.connectionKey || data.key || url.searchParams.get("key"));
  if (!clientId || !providedKey) return { response: Response.json({ ok: false, error: "Missing receptionist connection credentials." }, { status: 401 }) };

  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").doc(clientId).get();
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || accountSnapshot.data().billingPastDue === true) {
    return { response: Response.json({ ok: false, error: "That business account is not active." }, { status: 404 }) };
  }
  const connection = accountSnapshot.data();
  if (!text(connection.connectionKey)) return { response: Response.json({ ok: false, error: "The receptionist connection is not configured." }, { status: 403 }) };
  if (connection.enabled === false || !secretMatches(connection.connectionKey, providedKey)) {
    return { response: Response.json({ ok: false, error: "The receptionist connection is disabled or invalid." }, { status: 403 }) };
  }
  return { db, clientId };
}

export async function POST(request) {
  try {
    const data = await request.json().catch(() => ({}));
    const authorization = await authorize(request, data);
    if (authorization.response) return authorization.response;
    if (text(data.action).toLowerCase() !== "record") return Response.json({ ok: false, error: "Unsupported call usage action." }, { status: 400 });

    const callId = text(data.callId);
    if (!callId) return Response.json({ ok: false, error: "A call ID is required." }, { status: 400 });
    const occurredAt = Number.isFinite(Date.parse(data.startedAt)) ? Date.parse(data.startedAt) : Date.now();
    const usage = await recordLeadUsage({
      db: authorization.db,
      clientId: authorization.clientId,
      // Intake uses the same deterministic ID when this call also creates a lead,
      // so a call and its saved lead can never be charged twice.
      sourceId: billingLeadEventId(authorization.clientId, callId),
      occurredAt,
    });
    return Response.json({ ok: true, duplicate: usage.duplicate === true, balancePoints: usage.balancePoints, paymentStatus: usage.payment?.status || "not_due" });
  } catch (error) {
    console.error("Unable to process receptionist call usage", error);
    return Response.json({ ok: false, error: "Could not process receptionist call usage." }, { status: 500 });
  }
}
