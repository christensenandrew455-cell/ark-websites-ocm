import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/adminRequest";
import { getAdminBucket, getAdminDb } from "../../../../../lib/firebase-admin";
import { systemCollection } from "../../../../../lib/firestoreLayout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function safeDownloadName(value) {
  return text(value, 180).replace(/["\r\n\\/]/g, "-") || "support-screenshot";
}

export async function GET(request, { params }) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const { id } = await params;
    const requestId = text(id, 160);
    if (!/^[a-z0-9_-]+$/i.test(requestId)) return NextResponse.json({ error: "Choose a valid website request." }, { status: 400 });

    const db = getAdminDb();
    const snapshot = await systemCollection(db, "supportRequests").doc(requestId).get();
    if (!snapshot.exists) return NextResponse.json({ error: "That website request no longer exists." }, { status: 404 });

    const data = snapshot.data();
    if (data.type !== "website" && text(data.source) !== "public-website") {
      return NextResponse.json({ error: "That request has no website attachment." }, { status: 404 });
    }

    const attachment = data.attachment && typeof data.attachment === "object" ? data.attachment : {};
    const storagePath = text(attachment.storagePath, 800);
    if (!storagePath) return NextResponse.json({ error: "That request has no screenshot." }, { status: 404 });

    const [buffer] = await getAdminBucket().file(storagePath).download();
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": text(attachment.contentType, 100) || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${safeDownloadName(attachment.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Unable to open website support attachment", error);
    return NextResponse.json({ error: "The screenshot could not be opened." }, { status: 500 });
  }
}
