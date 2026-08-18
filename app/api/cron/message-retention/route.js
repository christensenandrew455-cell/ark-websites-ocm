import { NextResponse } from "next/server";
import { readAccountSections } from "../../../lib/accountSections";
import { getAdminDb } from "../../../lib/firebase-admin";
import { cleanupExpiredConversations, normalizeMessageRetentionDays } from "../../../lib/messageRetention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) { return String(value || "").trim(); }

function authorized(request) {
  const secret = text(process.env.CRON_SECRET);
  const authorization = text(request.headers.get("authorization"));
  return Boolean(secret) && authorization === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = getAdminDb();
  const businesses = await db.collection("accounts").where("status", "==", "active").get();
  const results = [];

  for (const business of businesses.docs) {
    const sections = await readAccountSections(business);
    const retentionDays = normalizeMessageRetentionDays(sections.customization.messageRetentionDays);
    if (!retentionDays) continue;
    try {
      const deleted = await cleanupExpiredConversations(db, business.id, retentionDays);
      results.push({ clientId: business.id, retentionDays, deleted });
    } catch (error) {
      console.error(`Message retention cleanup failed for ${business.id}`, error);
      results.push({ clientId: business.id, retentionDays, error: String(error?.message || "Cleanup failed.") });
    }
  }

  return NextResponse.json({ ok: true, accounts: results.length, results });
}
