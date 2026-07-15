import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STAGES = new Set(["contactedMe", "preClients", "clients", "postClients"]);

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

function cleanUrl(value) {
  const normalized = text(value);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function appOrigin(request) {
  return text(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

function connectionPayload(clientId, business, data, request) {
  const origin = appOrigin(request);
  const connectionKey = text(data.connectionKey);
  const baseUrl = `${origin}/api/intake?clientId=${encodeURIComponent(clientId)}&key=${encodeURIComponent(connectionKey)}`;

  return {
    clientId,
    businessName: text(business.businessName || data.businessName || clientId),
    enabled: data.enabled !== false,
    websiteUrl: text(data.websiteUrl),
    businessPhone: text(data.businessPhone),
    notificationPhone: text(data.notificationPhone),
    notificationEmail: text(data.notificationEmail),
    sourceLabel: text(data.sourceLabel || business.businessName || clientId),
    defaultStage: ALLOWED_STAGES.has(data.defaultStage) ? data.defaultStage : "contactedMe",
    allowStageOverride: data.allowStageOverride === true,
    notes: text(data.notes),
    connectionKey,
    websiteWebhookUrl: connectionKey ? `${baseUrl}&source=website` : "",
    phoneWebhookUrl: connectionKey ? `${baseUrl}&source=phone` : "",
  };
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const db = getAdminDb();
  const [businessSnapshot, connectionSnapshot] = await Promise.all([
    db.collection("businesses").get(),
    db.collection("connections").get(),
  ]);

  const connections = new Map(
    connectionSnapshot.docs.map((document) => [document.id, document.data()])
  );

  const businesses = businessSnapshot.docs
    .map((document) => {
      const business = document.data();
      const connection = connections.get(document.id) || {};
      return connectionPayload(document.id, business, connection, request);
    })
    .filter((business) => business.businessName)
    .sort((a, b) => a.businessName.localeCompare(b.businessName));

  return NextResponse.json({ businesses });
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const body = await request.json();
  const clientId = cleanClientId(body.clientId);
  if (!clientId) {
    return NextResponse.json({ error: "Choose a business account." }, { status: 400 });
  }

  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(clientId);
  const connectionRef = db.collection("connections").doc(clientId);
  const [businessSnapshot, connectionSnapshot] = await Promise.all([
    businessRef.get(),
    connectionRef.get(),
  ]);

  if (!businessSnapshot.exists) {
    return NextResponse.json({ error: "That business account does not exist." }, { status: 404 });
  }

  const business = businessSnapshot.data();
  const current = connectionSnapshot.exists ? connectionSnapshot.data() : {};
  const connectionKey = body.regenerateKey === true || !text(current.connectionKey)
    ? randomBytes(24).toString("hex")
    : text(current.connectionKey);

  const websiteUrl = text(body.websiteUrl);
  if (websiteUrl && !cleanUrl(websiteUrl)) {
    return NextResponse.json({ error: "Enter a valid website URL beginning with http:// or https://." }, { status: 400 });
  }

  const defaultStage = ALLOWED_STAGES.has(body.defaultStage) ? body.defaultStage : "contactedMe";
  const data = {
    clientId,
    businessName: text(business.businessName || clientId),
    enabled: body.enabled !== false,
    websiteUrl: cleanUrl(websiteUrl),
    businessPhone: text(body.businessPhone),
    notificationPhone: text(body.notificationPhone),
    notificationEmail: text(body.notificationEmail).toLowerCase(),
    sourceLabel: text(body.sourceLabel || business.businessName || clientId),
    defaultStage,
    allowStageOverride: body.allowStageOverride === true,
    notes: text(body.notes),
    connectionKey,
    updatedBy: admin.decodedToken.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(connectionSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };

  await connectionRef.set(data, { merge: true });

  return NextResponse.json({
    connection: connectionPayload(clientId, business, data, request),
  });
}
