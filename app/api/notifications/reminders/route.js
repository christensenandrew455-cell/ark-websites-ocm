import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase-admin";
import { sendUnreadLeadReminders } from "../../../lib/notificationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = String(process.env.OCM_REMINDER_SECRET || "").trim();
  const authorization = String(request.headers.get("authorization") || "");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await sendUnreadLeadReminders(getAdminDb());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Unable to send unread lead reminders", error);
    return NextResponse.json({ error: "Could not send unread lead reminders." }, { status: 500 });
  }
}
