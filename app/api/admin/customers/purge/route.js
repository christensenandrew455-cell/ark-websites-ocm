import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeDueCustomers } from "../../../../lib/customerLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedHash = createHash("sha256").update(String(expected)).digest();
  const providedHash = createHash("sha256").update(String(provided)).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

export async function POST(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!matches(process.env.OCM_REMINDER_SECRET, token)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const results = await purgeDueCustomers();
  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString(), results });
}
