import { createHash, timingSafeEqual } from "node:crypto";
import { sendAdminEvent } from "../../../lib/adminEvents";
import { recordCompletedCall } from "../../../lib/callPlanBilling";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

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
  if (!clientId || !providedKey) {
    return { response: Response.json({ ok: false, error: "Missing receptionist connection credentials." }, { status: 401 }) };
  }

  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").doc(clientId).get();
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active" || accountSnapshot.data().billingPastDue === true) {
    return { response: Response.json({ ok: false, error: "That business account is not active." }, { status: 404 }) };
  }
  const connection = accountSnapshot.data();
  if (!text(connection.connectionKey)) {
    return { response: Response.json({ ok: false, error: "The receptionist connection is not configured." }, { status: 403 }) };
  }
  if (connection.enabled === false || !secretMatches(connection.connectionKey, providedKey)) {
    return { response: Response.json({ ok: false, error: "The receptionist connection is disabled or invalid." }, { status: 403 }) };
  }
  return { db, clientId, businessName: text(connection.businessName || clientId) };
}

export async function POST(request) {
  try {
    const data = await request.json().catch(() => ({}));
    const authorization = await authorize(request, data);
    if (authorization.response) return authorization.response;
    if (text(data.action).toLowerCase() !== "record") {
      return Response.json({ ok: false, error: "Unsupported completed-call action." }, { status: 400 });
    }

    const callId = text(data.callId);
    if (!callId) return Response.json({ ok: false, error: "A call ID is required." }, { status: 400 });
    const occurredAt = Number.isFinite(Date.parse(data.startedAt)) ? Date.parse(data.startedAt) : Date.now();
    const call = await recordCompletedCall({
      db: authorization.db,
      clientId: authorization.clientId,
      callId,
      occurredAt,
      durationSeconds: data.durationSeconds,
      outcome: data.outcome || data.endReason,
      leadSaved: data.leadSaved === true,
    });

    if (!call.duplicate) {
      await sendAdminEvent({
        id: `receptionist-call-${call.callEventId}`,
        type: "receptionist.call.completed",
        clientId: authorization.clientId,
        businessName: authorization.businessName,
        summary: data.leadSaved === true ? "Receptionist call completed with a new lead" : "Receptionist call completed",
        metadata: {
          durationSeconds: Math.max(0, Number(data.durationSeconds || 0)),
          outcome: text(data.outcome || data.endReason).slice(0, 80),
          leadSaved: data.leadSaved === true,
          billingPlan: call.planKey,
          monthlyCalls: call.monthlyCallLimit,
          callsUsed: call.callsUsed,
          callsRemaining: call.callsRemaining,
        },
        occurredAt: new Date(occurredAt).toISOString(),
      });
    }

    return Response.json({
      ok: true,
      duplicate: call.duplicate,
      planKey: call.planKey,
      monthlyCallLimit: call.monthlyCallLimit,
      callsUsed: call.callsUsed,
      callsRemaining: call.callsRemaining,
      limitReached: call.limitReached,
      periodEndAt: call.periodEndAt,
    });
  } catch (error) {
    console.error("Unable to record receptionist call", error);
    return Response.json({ ok: false, error: "Could not record the completed receptionist call." }, { status: 500 });
  }
}
