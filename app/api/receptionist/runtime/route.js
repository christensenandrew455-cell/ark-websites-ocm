import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { readAccountSections } from "../../../lib/accountSections";
import { acceptedLeadPlanStatus } from "../../../lib/acceptedLeadPlanBilling";
import { getAdminDb } from "../../../lib/firebase-admin";
import { businessInformationText, normalizeBusinessInformation } from "../../../lib/receptionistBusinessInformation";
import { normalizeServiceAreas, serviceAreaFields } from "../../../lib/serviceAreas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_MAX_AGE_SECONDS = 300;

function text(value) {
  return String(value || "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function normalizePhone(value) {
  const raw = text(value).replace(/^tel:/i, "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function servicesObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([name, description]) => {
    const cleanName = text(name).toLowerCase();
    return [cleanName, text(description) || cleanName];
  }).filter(([name]) => name));
}

function weekdaySummary(days) {
  const labels = days.map((day) => `${day.charAt(0).toUpperCase()}${day.slice(1)}`);
  if (labels.length === 7) return "every day";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return labels.length ? `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}` : "";
}

function telnyxSignatureMatches(request, rawBody) {
  const configuredKey = text(process.env.TELNYX_PUBLIC_KEY);
  const signature = text(request.headers.get("telnyx-signature-ed25519"));
  const timestamp = text(request.headers.get("telnyx-timestamp"));
  if (!configuredKey || !signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_MAX_AGE_SECONDS) return false;

  try {
    const key = configuredKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(configuredKey.replaceAll("\\n", "\n"))
      : createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(configuredKey, "base64"),
          ]),
          format: "der",
          type: "spki",
        });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"));
  } catch (error) {
    console.error("Unable to verify Telnyx voice webhook signature", error);
    return false;
  }
}

function calledPhoneFromEvent(body) {
  const event = body?.data || body;
  const payload = event?.payload || body?.payload || body;
  const destination = Array.isArray(payload?.to) ? payload.to[0] : payload?.to;
  const value = destination?.phone_number
    || destination?.number
    || destination
    || payload?.called_number
    || payload?.destination
    || body?.to;
  return normalizePhone(value);
}

async function findConnection(db, calledPhone) {
  if (!calledPhone) return null;
  const normalized = await db.collection("accounts")
    .where("receptionistPhoneNormalized", "==", calledPhone)
    .limit(1)
    .get();
  if (!normalized.empty) return normalized.docs[0];

  const raw = await db.collection("accounts")
    .where("receptionistPhone", "==", calledPhone)
    .limit(1)
    .get();
  return raw.empty ? null : raw.docs[0];
}

function buildProfile(clientId, account) {
  const serviceAreas = normalizeServiceAreas(account.serviceAreas);
  const { states: serviceAreaStates, counties: serviceAreaCounties } = serviceAreaFields(serviceAreas);
  const services = servicesObject(account.services);
  const businessInformation = normalizeBusinessInformation(account.businessInformation);
  const businessType = text(account.businessType || account.businessBase);
  const businessBase = serviceAreas[0] || "the local service area";
  const normalizedServiceAreas = serviceAreas.length ? serviceAreas : [businessBase];
  const savedEstimateWeekdays = list(account.estimateWeekdays).map((day) => day.toLowerCase());
  const earliestEstimateStart = text(account.earliestEstimateStart);
  const latestEstimateStart = text(account.latestEstimateStart);
  const estimateSchedulingConfigured = Boolean(savedEstimateWeekdays.length && earliestEstimateStart && latestEstimateStart);

  return {
    clientId,
    businessName: text(account.businessName || clientId),
    ownerName: text(account.ownerName),
    timeZone: text(account.timeZone || "America/New_York"),
    estimateSchedulingConfigured,
    estimateDays: estimateSchedulingConfigured ? weekdaySummary(savedEstimateWeekdays) : "",
    estimateWeekdays: estimateSchedulingConfigured ? savedEstimateWeekdays : [],
    earliestEstimateStart: estimateSchedulingConfigured ? earliestEstimateStart : "",
    latestEstimateStart: estimateSchedulingConfigured ? latestEstimateStart : "",
    businessType,
    businessBase,
    serviceAreas: normalizedServiceAreas,
    serviceAreaMode: serviceAreaCounties.length ? "counties" : "states",
    serviceAreaStates,
    serviceAreaCounties,
    services,
    businessInformation,
    extraInformation: businessInformationText(businessInformation),
  };
}

function validateProfile(profile) {
  if (!profile.businessName) return "The matched account has no business name.";
  if (!profile.ownerName) return "The matched account has no owner name.";
  if (!Object.keys(profile.services).length) return "The matched account has no receptionist services configured.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: profile.timeZone }).format();
  } catch {
    return "The matched account has an invalid time zone.";
  }
  return "";
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    if (!telnyxSignatureMatches(request, rawBody)) {
      return NextResponse.json({ ok: false, error: "Invalid or expired Telnyx signature." }, { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: "The Telnyx event body is not valid JSON." }, { status: 400 });
    }

    const eventType = text(body?.data?.event_type || body?.event_type);
    if (!eventType.startsWith("call.")) {
      return NextResponse.json({ ok: false, error: "Only Telnyx call events can load receptionist settings." }, { status: 400 });
    }

    const calledPhone = calledPhoneFromEvent(body);
    if (!calledPhone) {
      return NextResponse.json({ ok: false, error: "The called phone number was missing from the Telnyx event." }, { status: 400 });
    }

    const db = getAdminDb();
    const accountSnapshot = await findConnection(db, calledPhone);
    if (!accountSnapshot) {
      return NextResponse.json({ ok: false, error: "No ARK account is connected to that phone number." }, { status: 404 });
    }

    const clientId = accountSnapshot.id;
    const sections = await readAccountSections(accountSnapshot);
    const account = sections.combined;

    if (account.status !== "active" || account.billingPastDue === true) {
      return NextResponse.json({ ok: false, error: "The connected business account is not active." }, { status: 404 });
    }
    if (account.enabled === false || account.receptionistEnabled === false) {
      return NextResponse.json({ ok: false, error: "The connected receptionist is disabled." }, { status: 403 });
    }
    if (account.businessSetupComplete !== true) {
      return NextResponse.json({ ok: false, error: "The business has not completed AI receptionist setup." }, { status: 409 });
    }

    const acceptedLeadPlan = acceptedLeadPlanStatus(account);

    const profile = buildProfile(clientId, account);
    const profileError = validateProfile(profile);
    if (profileError) {
      return NextResponse.json({ ok: false, error: profileError }, { status: 409 });
    }

    const connectionKey = text(account.connectionKey);
    if (!connectionKey) {
      return NextResponse.json({ ok: false, error: "The matched account is missing its private intake connection." }, { status: 409 });
    }

    const origin = new URL(request.url).origin;
    const intakeUrl = new URL("/api/intake", origin);
    intakeUrl.searchParams.set("clientId", clientId);
    intakeUrl.searchParams.set("key", connectionKey);
    intakeUrl.searchParams.set("source", `${clientId}-receptionist`);

    const callCompletionUrl = new URL("/api/receptionist/calls", origin);
    callCompletionUrl.searchParams.set("clientId", clientId);

    return NextResponse.json({
      ok: true,
      clientId,
      calledPhone,
      profile,
      acceptedLeadPlan,
      intakeUrl: intakeUrl.toString(),
      callCompletionUrl: callCompletionUrl.toString(),
      callCompletionKey: connectionKey,
      // Keep these aliases until every deployed receptionist has moved to the clearer call-completion names.
      usageUrl: callCompletionUrl.toString(),
      usageKey: connectionKey,
    });
  } catch (error) {
    console.error("Unable to load receptionist runtime settings", error);
    return NextResponse.json({ ok: false, error: "Could not load receptionist settings for that phone number." }, { status: 500 });
  }
}
