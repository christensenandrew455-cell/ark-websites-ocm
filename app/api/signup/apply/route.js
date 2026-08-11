import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    error: "Owner accounts are created only after the payment method is confirmed. Continue through the four signup steps.",
  }, { status: 409 });
}
