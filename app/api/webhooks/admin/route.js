import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { isStandardRole } from "../../../lib/accountRoles";
import { sendAdminEvent, verifyAdminEvent } from "../../../lib/adminEvents";
import { getAdminDb } from "../../../lib/firebase-admin";
import { PUSH_NOTIFICATION_COPY } from "../../../lib/notificationCopy";
import { sendAccountPushNotification } from "../../../lib/notificationService";
import { syncRevenueLedger } from "../../../lib/revenueLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value) { return String(value || "").trim(); }
function clientId(value) { return text(value).toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""); }
function normalizePhone(value) {
  const digits = text(value).replace(/^tel:/i, "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}
function areaCode(value) { return normalizePhone(value).replace(/^\+1/, "").slice(0, 3); }

async function assignNumber(body) {
  const id = clientId(body.clientId);
  const receptionistPhone = normalizePhone(body.receptionistPhone);
  if (!id) return Response.json({ error: "Choose an account that needs a number." }, { status: 400 });
  if (!receptionistPhone) return Response.json({ error: "Enter a valid 10-digit receptionist number." }, { status: 400 });

  const db = getAdminDb();
  const ref = db.collection("accounts").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || !isStandardRole(snapshot.data().role)) return Response.json({ error: "That account no longer exists." }, { status: 404 });
  const account = snapshot.data();
  const ownerAreaCode = areaCode(account.accountPhone);
  if (account.status !== "active" || !["needed", "assigned"].includes(text(account.numberAssignmentStatus))) {
    return Response.json({ error: "That account no longer needs a number." }, { status: 409 });
  }
  if (!ownerAreaCode || areaCode(receptionistPhone) !== ownerAreaCode) {
    return Response.json({ error: `Assign a receptionist number with the same ${ownerAreaCode || "customer"} area code as the owner's phone.` }, { status: 400 });
  }
  const duplicate = await db.collection("accounts").where("receptionistPhoneNormalized", "==", receptionistPhone).limit(2).get();
  if (duplicate.docs.some((document) => document.id !== id)) return Response.json({ error: "That receptionist number is already assigned to another account." }, { status: 409 });

  const alreadyAssigned = text(account.numberAssignmentStatus) === "assigned" && text(account.receptionistPhoneNormalized) === receptionistPhone;
  const update = {
    numberAssignmentStatus: "assigned",
    receptionistPhone,
    receptionistPhoneNormalized: receptionistPhone,
    numberAssignedAt: alreadyAssigned ? account.numberAssignedAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    numberAssignedBy: "ark-admin-webhook",
    enabled: true,
    receptionistEnabled: true,
    connectionKey: text(account.connectionKey) || randomBytes(24).toString("hex"),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(update, { merge: true });

  const notification = alreadyAssigned
    ? { attempted: 0, sent: 0, failed: 0, skipped: true }
    : await sendAccountPushNotification({
        db,
        clientId: id,
        notification: PUSH_NOTIFICATION_COPY.numberAssigned,
        type: "number-assigned",
        route: "/",
        eventId: `number-assigned-${id}-${receptionistPhone}`,
      }).catch((error) => {
        console.error("Unable to send number-assignment push", error);
        return { attempted: 0, sent: 0, failed: 1 };
      });

  await sendAdminEvent({
    id: `number-assigned-${id}-${receptionistPhone.replace(/\D/g, "")}`,
    type: "account.number_assigned",
    clientId: id,
    businessName: text(account.businessName || id),
    summary: "Receptionist number assigned and customer notified",
    metadata: { receptionistPhone, notificationSent: notification.sent > 0 },
  });

  return Response.json({ ok: true, clientId: id, receptionistPhone, numberAssignmentStatus: "assigned", notification });
}

async function syncRevenue() {
  try {
    const stripeKey = text(process.env.STRIPE_SECRET_KEY);
    const result = await syncRevenueLedger({
      db: getAdminDb(),
      stripe: stripeKey ? new Stripe(stripeKey) : null,
      includePayments: true,
    });
    return Response.json({ ok: true, revenueSync: result });
  } catch (error) {
    console.error("Unable to reconcile the ARK revenue ledger", error);
    return Response.json({ error: "Revenue could not be refreshed right now." }, { status: 500 });
  }
}

export async function POST(request) {
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 32 * 1024) return Response.json({ error: "The webhook request is too large." }, { status: 413 });
  const verification = verifyAdminEvent({
    secret: process.env.ARK_WEBHOOK_SECRET || process.env.ARC_WEBHOOK_SECRET,
    timestamp: request.headers.get("x-ark-timestamp") || request.headers.get("x-arc-timestamp"),
    signature: request.headers.get("x-ark-signature") || request.headers.get("x-arc-signature"),
    body: rawBody,
  });
  if (!verification.ok) return Response.json({ error: verification.error }, { status: verification.status });

  let body;
  try { body = JSON.parse(rawBody); } catch { return Response.json({ error: "The webhook body must be valid JSON." }, { status: 400 }); }
  if (text(body.type) === "account.number.assign") return assignNumber(body);
  if (text(body.type) === "billing.revenue.sync") return syncRevenue();
  return Response.json({ error: "That ARK Admin webhook event is not supported." }, { status: 400 });
}
