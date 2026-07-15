import { NextResponse } from "next/server";

const message = "The legacy submissions webhook has been disabled. Create a business connection in ARK OCM and use its generated intake URL.";

export async function GET() {
  return NextResponse.json({ ok: false, error: message }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ ok: false, error: message }, { status: 410 });
}
