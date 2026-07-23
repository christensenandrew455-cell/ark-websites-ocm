import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
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

function authorized(request) {
  const expected = text(process.env.RECEPTIONIST_CONFIG_SECRET);
  if (!expected) return false;
  const authorization = text(request.headers.get("authorization"));
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const supplied = bearer || text(request.headers.get("x-ark-receptionist-key"));
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function appOrigin(request) {
  return text(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const phone = normalizePhone(url.searchParams.get("phone"));
  const connectionId = text(url.searchParams.get("connectionId"));
  if (!phone) return NextResponse.json({ error: "A destination phone number is required." }, { status: 400 });

  const db = getAdminDb();
  const connectionSnapshot = await db.collection("connections")
    .where("receptionistPhoneNormalized", "==", phone)
    .limit(2)
    .get();
  if (connectionSnapshot.empty) return NextResponse.json({ error: "No receptionist is assigned to that number." }, { status: 404 });
  if (connectionSnapshot.size > 1) return NextResponse.json({ error: "That number is assigned more than once." }, { status: 409 });

  const connectionDocument = connectionSnapshot.docs[0];
  const clientId = connectionDocument.id;
  const connection = connectionDocument.data();
  if (connection.enabled === false || connection.receptionistEnabled === false) {
    return NextResponse.json({ error: "That receptionist is disabled." }, { status: 403 });
  }
  if (connectionId && text(connection.telnyxConnectionId) && text(connection.telnyxConnectionId) !== connectionId) {
    return NextResponse.json({ error: "The Telnyx connection ID does not match this phone number." }, { status: 403 });
  }

  const [businessSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("businesses").doc(clientId).get(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist").get(),
  ]);
  if (!businessSnapshot.exists || !settingsSnapshot.exists) {
    return NextResponse.json({ error: "The receptionist profile is incomplete." }, { status: 404 });
  }

  const businessAccount = businessSnapshot.data();
  const settings = settingsSnapshot.data();
  if (businessAccount.status === "disabled" || settings.enabled === false) {
    return NextResponse.json({ error: "That business receptionist is disabled." }, { status: 403 });
  }

  const connectionKey = text(connection.connectionKey);
  if (!connectionKey) return NextResponse.json({ error: "The client connection key is missing." }, { status: 409 });

  const origin = appOrigin(request);
  const source = text(connection.sourceLabel || `${clientId}-receptionist`);
  const intakeUrl = new URL(`${origin}/api/intake`);
  intakeUrl.searchParams.set("clientId", clientId);
  intakeUrl.searchParams.set("key", connectionKey);
  intakeUrl.searchParams.set("source", source);
  const usageUrl = new URL(`${origin}/api/receptionist/call-usage`);
  usageUrl.searchParams.set("clientId", clientId);
  usageUrl.searchParams.set("key", connectionKey);

  const response = NextResponse.json({
    ok: true,
    profile: {
      clientId,
      connectionKey,
      source,
      ocmWebhookUrl: intakeUrl.toString(),
      ocmUsageUrl: usageUrl.toString(),
      receptionistScript: text(settings.receptionistScript),
      ai: {
        voice: text(settings.aiVoice || "alloy"),
        speechSpeed: Number(settings.aiSpeechSpeed || 1),
        silenceMs: Number(settings.aiSilenceMs || 900),
      },
      business: {
        name: text(settings.businessName || businessAccount.businessName || clientId),
        receptionist: text(settings.receptionistName || "Alex"),
        owner: text(settings.ownerName || businessAccount.ownerName),
        phone: text(settings.businessPhone || connection.businessPhone || businessAccount.accountPhone),
        email: text(settings.businessEmail || connection.notificationEmail || businessAccount.accountEmail).toLowerCase(),
        hours: text(settings.businessHours),
        timeZone: text(settings.timeZone || "America/New_York"),
        estimateDays: text(settings.estimateDays),
        estimateWeekdays: Array.isArray(settings.estimateWeekdays) ? settings.estimateWeekdays : [],
        earliestEstimateStart: text(settings.earliestEstimateStart),
        latestEstimateStart: text(settings.latestEstimateStart),
        base: text(settings.businessBase),
        serviceAreas: Array.isArray(settings.serviceAreas) ? settings.serviceAreas : [],
        services: settings.services && typeof settings.services === "object" ? settings.services : {},
        about: Array.isArray(settings.about) ? settings.about : [],
        openingLine: text(settings.openingLine),
        closingLine: text(settings.closingLine),
        extraInformation: text(settings.businessInfo),
      },
    },
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
