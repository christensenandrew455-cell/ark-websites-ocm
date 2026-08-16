import { NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/adminRequest";
import { isStandardRole } from "../../../lib/accountRoles";
import { getAdminDb } from "../../../lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  const db = getAdminDb();
  const accountSnapshot = await db.collection("accounts").get();

  const customerDocuments = accountSnapshot.docs.filter((document) => isStandardRole(document.data().role));
  const rows = await Promise.all(customerDocuments.map(async (document) => {
    const business = document.data();
    const devicesSnapshot = await db
      .collection("accounts")
      .doc(document.id)
      .collection("notificationDevices")
      .get();
    const devices = devicesSnapshot.docs.map((deviceDocument) => deviceDocument.data());
    const enabledDevices = devices.filter((device) => device.notificationsEnabled !== false && text(device.token));

    return {
      clientId: document.id,
      businessName: text(business.businessName || document.id),
      ownerName: text(business.ownerName),
      accountEmail: text(business.accountEmail),
      accountStatus: text(business.status || "active"),
      connectionEnabled: business.enabled !== false,
      deviceCount: devices.length,
      enabledDeviceCount: enabledDevices.length,
      unreadLeadCount: devices.reduce((total, device) => total + Number(device.unreadLeadCount || 0), 0),
      lastLeadAt: iso(business.lastLeadAt),
      lastPushAt: iso(devices.map((device) => device.lastPushAt).filter(Boolean).sort((a, b) => {
        const aMs = typeof a?.toMillis === "function" ? a.toMillis() : Number(a?.seconds || 0) * 1000;
        const bMs = typeof b?.toMillis === "function" ? b.toMillis() : Number(b?.seconds || 0) * 1000;
        return bMs - aMs;
      })[0]),
      lastReminderAt: iso(devices.map((device) => device.lastReminderSentAt).filter(Boolean).sort((a, b) => {
        const aMs = typeof a?.toMillis === "function" ? a.toMillis() : Number(a?.seconds || 0) * 1000;
        const bMs = typeof b?.toMillis === "function" ? b.toMillis() : Number(b?.seconds || 0) * 1000;
        return bMs - aMs;
      })[0]),
    };
  }));

  rows.sort((a, b) => a.businessName.localeCompare(b.businessName));
  return NextResponse.json({ businesses: rows });
}
