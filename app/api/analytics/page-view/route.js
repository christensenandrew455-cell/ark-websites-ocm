import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function safeUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function shortHash(value) {
  return createHash("sha256").update(text(value)).digest("hex").slice(0, 24);
}

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin") || "*"),
  });
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin || "*");

  try {
    const body = await request.json();
    const clientId = cleanClientId(body.clientId);
    if (!clientId) {
      return Response.json({ ok: false, error: "Missing business ID." }, { status: 400, headers });
    }

    const db = getAdminDb();
    const [businessSnapshot, connectionSnapshot] = await Promise.all([
      db.collection("businesses").doc(clientId).get(),
      db.collection("connections").doc(clientId).get(),
    ]);

    if (!businessSnapshot.exists || businessSnapshot.data().status !== "active") {
      return Response.json({ ok: false, error: "Business is not active." }, { status: 404, headers });
    }

    const connection = connectionSnapshot.exists ? connectionSnapshot.data() : {};
    if (connection.enabled === false) {
      return Response.json({ ok: false, error: "Tracking is disabled." }, { status: 403, headers });
    }

    const configuredHost = hostname(connection.websiteUrl);
    const requestHost = hostname(origin);
    if (configuredHost && requestHost && configuredHost !== requestHost) {
      return Response.json({ ok: false, error: "Website origin does not match this business." }, { status: 403, headers });
    }

    const pageUrl = safeUrl(body.url);
    const pagePath = text(body.path || (pageUrl ? new URL(pageUrl).pathname : "/")).slice(0, 300);
    const referrer = safeUrl(body.referrer).slice(0, 600);
    const sessionId = text(body.sessionId).slice(0, 160);
    const userAgent = text(request.headers.get("user-agent")).slice(0, 500);

    const eventRef = db
      .collection("ocmClients")
      .doc(clientId)
      .collection("analyticsEvents")
      .doc();

    await eventRef.set({
      eventType: "page_view",
      channel: "website",
      path: pagePath || "/",
      url: pageUrl,
      referrer,
      sessionHash: sessionId ? shortHash(sessionId) : "",
      userAgentHash: userAgent ? shortHash(userAgent) : "",
      createdAt: FieldValue.serverTimestamp(),
    });

    if (connectionSnapshot.exists) {
      await connectionSnapshot.ref.set({
        lastPageViewAt: FieldValue.serverTimestamp(),
        lastPageViewPath: pagePath || "/",
      }, { merge: true });
    }

    return Response.json({ ok: true }, { status: 201, headers });
  } catch (error) {
    console.error("Unable to record website view", error);
    return Response.json({ ok: false, error: "Could not record website view." }, { status: 500, headers });
  }
}
