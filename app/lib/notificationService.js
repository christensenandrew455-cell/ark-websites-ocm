import { FieldValue } from "firebase-admin/firestore";
import { getAdminMessaging } from "./firebase-admin";

const MAX_MULTICAST_TARGETS = 500;
const REMINDER_COOLDOWN_MS = 50 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function chunks(items, size = MAX_MULTICAST_TARGETS) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function isInvalidTarget(error) {
  const code = String(error?.code || "");
  return [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
    "messaging/invalid-argument",
  ].includes(code);
}

async function sendToDevices(devices, message) {
  const messaging = getAdminMessaging();
  const results = [];

  for (const deviceChunk of chunks(devices)) {
    const response = await messaging.sendEachForMulticast({
      ...message,
      tokens: deviceChunk.map((device) => device.token),
    });

    response.responses.forEach((item, index) => {
      results.push({ device: deviceChunk[index], response: item });
    });
  }

  return results;
}

async function notificationDevices(db, clientId) {
  const snapshot = await db
    .collection("ocmClients")
    .doc(clientId)
    .collection("notificationDevices")
    .get();

  return snapshot.docs
    .map((document) => ({ ref: document.ref, ...document.data() }))
    .filter((device) => device.notificationsEnabled !== false && text(device.token));
}

export async function sendNewLeadNotification({ db, clientId, row, leadId }) {
  const devices = await notificationDevices(db, clientId);
  if (!devices.length) return { attempted: 0, sent: 0, failed: 0 };

  const caller = text(row.Name || row.Phone || row.Email || "A new caller");
  const job = text(row.Job);
  const body = job
    ? `${caller} contacted you about ${job}. Tap to review the lead.`
    : `${caller} contacted your business. Tap to review the lead.`;

  const results = await sendToDevices(devices, {
    notification: {
      title: "New lead received",
      body,
    },
    data: {
      type: "new-lead",
      route: "/review-my-clients?section=contacted",
      clientId,
      leadId: text(leadId),
    },
    android: {
      priority: "high",
      notification: {
        channelId: "new-leads",
        sound: "default",
        tag: `lead-${text(leadId)}`,
      },
    },
  });

  const batch = db.batch();
  let sent = 0;
  let failed = 0;

  results.forEach(({ device, response }) => {
    if (response.success) {
      sent += 1;
      batch.set(device.ref, {
        unreadLeadCount: FieldValue.increment(1),
        lastLeadAt: FieldValue.serverTimestamp(),
        lastPushAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      failed += 1;
      if (isInvalidTarget(response.error)) batch.delete(device.ref);
      else {
        batch.set(device.ref, {
          unreadLeadCount: FieldValue.increment(1),
          lastLeadAt: FieldValue.serverTimestamp(),
          lastPushError: text(response.error?.message || response.error?.code),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
  });

  await batch.commit();
  return { attempted: devices.length, sent, failed };
}

export async function sendUnreadLeadReminders(db) {
  const connectionsSnapshot = await db.collection("connections").get();
  const now = Date.now();
  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const connectionDocument of connectionsSnapshot.docs) {
    const connection = connectionDocument.data();
    const lastLeadAt = asMillis(connection.lastLeadAt);
    if (connection.enabled === false || !lastLeadAt) continue;

    const devicesSnapshot = await db
      .collection("ocmClients")
      .doc(connectionDocument.id)
      .collection("notificationDevices")
      .get();

    const devices = devicesSnapshot.docs
      .map((document) => ({ ref: document.ref, ...document.data() }))
      .filter((device) => {
        if (device.notificationsEnabled === false || !text(device.token)) return false;
        if (Number(device.unreadLeadCount || 0) <= 0) return false;
        if (asMillis(device.lastViewedLeadsAt) >= lastLeadAt) return false;
        return now - asMillis(device.lastReminderSentAt) >= REMINDER_COOLDOWN_MS;
      });

    if (!devices.length) continue;
    attempted += devices.length;

    const results = await sendToDevices(devices, {
      notification: {
        title: "New clients are waiting",
        body: "You still have new contacts waiting in the Clients tab.",
      },
      data: {
        type: "unread-lead-reminder",
        route: "/review-my-clients?section=contacted",
        clientId: connectionDocument.id,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "lead-reminders",
          sound: "default",
          tag: `unread-leads-${connectionDocument.id}`,
        },
      },
    });

    const batch = db.batch();
    results.forEach(({ device, response }) => {
      if (response.success) {
        sent += 1;
        batch.set(device.ref, {
          lastReminderSentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        failed += 1;
        if (isInvalidTarget(response.error)) batch.delete(device.ref);
        else {
          batch.set(device.ref, {
            lastReminderError: text(response.error?.message || response.error?.code),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }
    });
    await batch.commit();
  }

  return { attempted, sent, failed };
}

export async function sendRequestStatusNotification({ db, clientId, requestId, subject, status, adminNote }) {
  const devices = await notificationDevices(db, clientId);
  if (!devices.length) return { attempted: 0, sent: 0, failed: 0 };

  const safeSubject = text(subject || "Your request");
  const safeNote = text(adminNote).slice(0, 220);
  const copy = status === "in-progress"
    ? {
        title: "Your request has started",
        body: safeNote || `${safeSubject} is now being worked on.`,
      }
    : status === "completed"
      ? {
          title: "Your request is complete",
          body: safeNote || `${safeSubject} has been completed.`,
        }
      : {
          title: "Your request was denied",
          body: safeNote || `${safeSubject} could not be approved. Open the app for details.`,
        };

  const results = await sendToDevices(devices, {
    notification: copy,
    data: {
      type: "request-status",
      route: "/messages",
      clientId,
      requestId: text(requestId),
      status,
    },
    android: {
      priority: "high",
      notification: {
        channelId: "request-updates",
        sound: "default",
        tag: `request-${text(requestId)}`,
      },
    },
  });

  const batch = db.batch();
  let sent = 0;
  let failed = 0;

  results.forEach(({ device, response }) => {
    if (response.success) {
      sent += 1;
      batch.set(device.ref, {
        lastRequestPushAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      failed += 1;
      if (isInvalidTarget(response.error)) batch.delete(device.ref);
      else {
        batch.set(device.ref, {
          lastRequestPushError: text(response.error?.message || response.error?.code),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
  });

  await batch.commit();
  return { attempted: devices.length, sent, failed };
}
