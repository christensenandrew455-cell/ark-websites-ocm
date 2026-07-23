import { createHash, timingSafeEqual } from "node:crypto";
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

function secretMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

function authorized(request) {
  const expected = text(process.env.RECEPTIONIST_CONFIG_SECRET);
  const authorization = text(request.headers.get("authorization"));
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const supplied = bearer || text(request.headers.get("x-ark-receptionist-key"));
  return secretMatches(expected, supplied);
}

export async function GET(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const phone = normalizePhone(requestUrl.searchParams.get("phone"));
  const connectionId = text(requestUrl.searchParams.get("connectionId"));
  if (!phone) {
    return NextResponse.json({ error: "The called phone number is required." }, { status: 400 });
  }

  const db = getAdminDb();
  const connectionSnapshot = await db.collection("connections")
    .where("receptionistPhoneNormalized", "==", phone)
    .limit(2)
    .get();

  if (connectionSnapshot.empty) {
    return NextResponse.json({ error: "No AI receptionist is assigned to that phone number." }, { status: 404 });
  }
  if (connectionSnapshot.size > 1) {
    return NextResponse.json({ error: "That phone number is assigned to more than one account." }, { status: 409 });
  }

  const connectionDocument = connectionSnapshot.docs[0];
  const clientId = connectionDocument.id;
  const connection = connectionDocument.data();
  const storedConnectionId = text(connection.telnyxConnectionId);
  if (connectionId && storedConnectionId && connectionId !== storedConnectionId) {
    return NextResponse.json({ error: "The Telnyx connection ID does not match this phone number." }, { status: 403 });
  }

  const [businessSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("businesses").doc(clientId).get(),
    db.collection("ocmClients").doc(clientId).collection("settings").doc("receptionist").get(),
  ]);

  if (!businessSnapshot.exists || !settingsSnapshot.exists) {
    return NextResponse.json({ error: "The AI receptionist profile is incomplete." }, { status: 404 });
  }

  const businessAccount = businessSnapshot.data();
  const settings = settingsSnapshot.data();
  if (
    businessAccount.status === "disabled"
    || connection.enabled === false
    || connection.receptionistEnabled === false
    || settings.enabled === false
  ) {
    return NextResponse.json({ error: "The AI receptionist is disabled." }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  const intakeUrl = new URL("/api/receptionist/intake", origin);
  intakeUrl.searchParams.set("phone", phone);

  const response = NextResponse.json({
    ok: true,
    clientId,
    routingPhone: phone,
    intakeUrl: intakeUrl.toString(),
    source: text(connection.sourceLabel || settings.businessName || businessAccount.businessName || "AI receptionist"),
    ai: {
      voice: text(settings.aiVoice || "alloy"),
      speechSpeed: Number(settings.aiSpeechSpeed || 0.94),
      silenceMs: Number(settings.aiSilenceMs || 1200),
    },
    business: {
      name: text(settings.businessName || businessAccount.businessName || clientId),
      receptionist: text(settings.receptionistName || "Alex"),
      owner: text(settings.ownerName || businessAccount.ownerName),
      phone: text(settings.businessPhone || businessAccount.accountPhone),
      email: text(settings.businessEmail || businessAccount.accountEmail).toLowerCase(),
      hours: text(settings.businessHours),
      timeZone: text(settings.timeZone || "America/New_York"),
      estimateDays: text(settings.estimateDays),
      estimateWeekdays: Array.isArray(settings.estimateWeekdays) ? settings.estimateWeekdays : [],
      earliestEstimateStart: text(settings.earliestEstimateStart),
      latestEstimateStart: text(settings.latestEstimateStart),
      base: text(settings.businessBase),
      serviceAreas: Array.isArray(settings.serviceAreas) ? settings.serviceAreas : [],
      services: settings.services && typeof settings.services === "object" && !Array.isArray(settings.services)
        ? settings.services
        : {},
      facts: Array.isArray(settings.about) ? settings.about : [],
      openingLine: text(settings.openingLine),
      closingLine: text(settings.closingLine),
    },
  });

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
