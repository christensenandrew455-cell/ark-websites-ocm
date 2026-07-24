import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/userRequest";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }
function deviceId(token) { return createHash("sha256").update(token).digest("hex"); }
function cleanClientId(value) { return text(value).toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""); }

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  const clientId = cleanClientId(decoded.role === "employee" ? decoded.businessClientId || decoded.clientId : decoded.clientId);
  if (!["customer", "employee"].includes(decoded.role) || !clientId) return NextResponse.json({ error: "An owner or employee account is required." }, { status: 403 });

  try {
    const body = await request.json();
    const action = text(body.action || "register").toLowerCase();
    const db = getAdminDb();
    const devices = db.collection("ocmClients").doc(clientId).collection("notificationDevices");

    if (action === "mark-viewed") {
      const snapshot = await devices.where("uid", "==", decoded.uid).get();
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.set(document.ref, { unreadLeadCount: 0, unreadMessageCount: 0, lastViewedLeadsAt: FieldValue.serverTimestamp(), lastViewedMessagesAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
      await batch.commit();
      return NextResponse.json({ ok: true, updatedDevices: snapshot.size });
    }

    const token = text(body.token);
    if (token.length < 20) return NextResponse.json({ error: "A valid notification token is required." }, { status: 400 });
    const reference = devices.doc(deviceId(token));
    await reference.set({ uid: decoded.uid, role: decoded.role, clientId, token, platform: text(body.platform || "android"), appVersion: text(body.appVersion || "1.1"), notificationsEnabled: true, updatedAt: FieldValue.serverTimestamp(), registeredAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to update notification device", error);
    return NextResponse.json({ error: "Could not update notification settings." }, { status: 500 });
  }
}
