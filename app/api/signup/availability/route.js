import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { checkRequestRateLimit, rateLimitResponse } from "../../../lib/requestRateLimit";
import {
  checkSignupAvailability,
  normalizeSignupEmail,
  normalizeSignupPhone,
  signupAvailabilityMessage,
} from "../../../lib/signupAvailability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const accountEmail = normalizeSignupEmail(body.accountEmail);
    const accountPhone = normalizeSignupPhone(body.accountPhone);
    if (!/^\S+@\S+\.\S+$/.test(accountEmail)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (!/^\+1\d{10}$/.test(accountPhone)) return NextResponse.json({ error: "Enter a 10-digit phone number." }, { status: 400 });

    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({ db, request, scope: "signup-availability", limit: 30, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const availability = await checkSignupAvailability({
      auth: getAdminAuth(),
      db,
      accountEmail,
      accountPhone,
    });
    const error = signupAvailabilityMessage(availability);
    if (error) {
      return NextResponse.json({
        error,
        available: false,
        emailInUse: availability.emailInUse,
        phoneInUse: availability.phoneInUse,
      }, { status: 409 });
    }
    return NextResponse.json({ available: true, emailInUse: false, phoneInUse: false });
  } catch (error) {
    console.error("Unable to check signup availability", error);
    return NextResponse.json({ error: "Unable to check whether that email and phone are available right now." }, { status: 500 });
  }
}
