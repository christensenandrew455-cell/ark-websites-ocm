import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { sendAdminEvent } from "../../../lib/adminEvents";
import { getAdminBucket, getAdminDb } from "../../../lib/firebase-admin";
import { systemCollection } from "../../../lib/firestoreLayout";
import { checkRequestRateLimit } from "../../../lib/requestRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.floor(4.4 * 1024 * 1024);
const ALLOWED_SCREENSHOT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CATEGORY_LABELS = Object.freeze({
  sales: "Sales question",
  account: "Account help",
  privacy: "Privacy request",
  messaging: "Messaging concern",
});

function text(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function validPhone(value) {
  const digits = text(value, 40).replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value, 254));
}

function safeFileName(value) {
  const cleaned = text(value, 180)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]|[-.]$/g, "");
  return cleaned || "support-screenshot";
}

async function readSubmission(request) {
  const contentType = text(request.headers.get("content-type"), 200).toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      category: formData.get("category"),
      name: formData.get("name"),
      contactEmail: formData.get("contactEmail"),
      contactPhone: formData.get("contactPhone"),
      senderNumber: formData.get("senderNumber"),
      businessName: formData.get("businessName"),
      description: formData.get("description"),
      consent: formData.get("consent"),
      companyWebsite: formData.get("website") || formData.get("companyWebsite"),
      screenshot: formData.get("screenshot"),
    };
  }

  const body = await request.json();
  return {
    category: body.category || "account",
    name: body.name,
    contactEmail: body.contactEmail || body.email,
    contactPhone: body.contactPhone || body.phone,
    senderNumber: body.senderNumber,
    businessName: body.businessName,
    description: body.description || body.message,
    consent: body.consent,
    companyWebsite: body.website || body.companyWebsite,
    screenshot: null,
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, init = {}) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeaders(), ...(init.headers || {}) } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  let uploadedFile = null;
  try {
    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({ db, request, scope: "public-support", limit: 5, windowMs: 10 * 60 * 1000 });
    if (!rateLimit.allowed) return json(
      { error: "Too many requests. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "The request is too large. Use a screenshot that is 4 MB or smaller." }, { status: 413 });
    }

    const body = await readSubmission(request);
    if (text(body.companyWebsite, 200)) return json({ ok: true }, { status: 201 });

    const category = text(body.category, 30).toLowerCase();
    const categoryLabel = CATEGORY_LABELS[category];
    const name = text(body.name, 120);
    const businessName = text(body.businessName, 160);
    const contactEmail = text(body.contactEmail, 254).toLowerCase();
    const contactPhone = text(body.contactPhone, 40);
    const senderNumber = text(body.senderNumber, 40);
    const message = text(body.description, 4000);
    const consent = body.consent === true || text(body.consent, 10).toLowerCase() === "true";
    const hasValidEmail = Boolean(contactEmail) && validEmail(contactEmail);
    const hasValidPhone = Boolean(contactPhone) && validPhone(contactPhone);

    if (!categoryLabel || !name || (!hasValidEmail && !hasValidPhone) || message.length < 10 || !consent) {
      return json({ error: "Complete the required fields and add an email or phone." }, { status: 400 });
    }
    if (category === "messaging" && !validPhone(senderNumber)) {
      return json({ error: "Enter the business number that sent the message." }, { status: 400 });
    }

    const ref = systemCollection(db, "supportRequests").doc();
    const screenshot = body.screenshot;
    let attachment = null;
    if (screenshot && typeof screenshot.arrayBuffer === "function" && Number(screenshot.size || 0) > 0) {
      if (!ALLOWED_SCREENSHOT_TYPES.has(screenshot.type)) {
        return json({ error: "The screenshot must be a JPG, PNG, or WebP image." }, { status: 400 });
      }
      if (screenshot.size > MAX_SCREENSHOT_BYTES) {
        return json({ error: "The screenshot must be 4 MB or smaller." }, { status: 400 });
      }

      const fileName = safeFileName(screenshot.name);
      const storagePath = `supportRequests/${ref.id}/${Date.now()}-${fileName}`;
      uploadedFile = getAdminBucket().file(storagePath);
      await uploadedFile.save(Buffer.from(await screenshot.arrayBuffer()), {
        resumable: false,
        metadata: {
          contentType: screenshot.type,
          metadata: { supportRequestId: ref.id },
        },
      });
      attachment = {
        fileName,
        contentType: screenshot.type,
        size: Number(screenshot.size || 0),
        storagePath,
      };
    }

    await ref.set({
      clientId: "public-website",
      businessName: businessName || "Public website visitor",
      ownerName: name,
      accountEmail: hasValidEmail ? contactEmail : "",
      contactEmail: hasValidEmail ? contactEmail : "",
      contactPhone: hasValidPhone ? contactPhone : "",
      senderNumber: category === "messaging" ? senderNumber : "",
      type: "website",
      category,
      categoryLabel,
      subject: `${categoryLabel}: ${businessName || name}`,
      message,
      status: "new",
      priority: "normal",
      source: "public-website",
      contactConsent: true,
      ...(attachment ? { attachment } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await sendAdminEvent({
      id: `website-${ref.id}`,
      type: "support.website.created",
      clientId: "public-website",
      businessName: businessName || name,
      summary: `${categoryLabel}: ${businessName || name}`,
      metadata: { requestId: ref.id, category },
    });

    return json({ ok: true, id: ref.id }, { status: 201 });
  } catch (error) {
    if (uploadedFile) await uploadedFile.delete({ ignoreNotFound: true }).catch(() => null);
    console.error("Unable to submit public support request", error);
    return json({ error: "Couldn’t send the request. Try again." }, { status: 500 });
  }
}
