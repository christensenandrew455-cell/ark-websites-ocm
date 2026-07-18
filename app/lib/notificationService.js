import { FieldValue } from "firebase-admin/firestore";
import { getAdminMessaging } from "./firebase-admin";

const MAX_MULTICAST_TARGETS = 500;
const REMINDER_COOLDOWN_MS = 50 * 60 * 1000;
const PUSH_RETRY_DELAY_MS = 600;

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

function isRetryableTarget(error) {
  const code = String(error?.code || "");
  return [
    "messaging/internal-error",
    "messaging/server-unavailable",
    "messaging/unknown-error",
    "messaging/quota-exceeded",
  ].includes(code) || /temporar|timeout|unavailable|internal/i.test(String(error?.message || ""));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendDeviceChunk(messaging, deviceChunk, message) {
  try {
    const response = await messaging.sendEachForMulticast({
      ...message,
      tokens: deviceChunk.map((device) => device.token),
    });
    return response.responses.map((item, index) => ({ device: deviceChunk[index], response: item }));
  } catch (error) {
    return deviceChunk.map((device) => ({
      device,
      response: { success: false, error },
    }));
  }
}

async function sendToDevices(devices, message) {
  const messaging = getAdminMessaging();
  const results = [];

  for (const deviceChunk of chunks(devices)) {
    results.push(...await sendDeviceChunk(messaging, deviceChunk, message));
  }

  const retryTargets = results
    .filter(({ response }) => !response.success && isRetryableTarget(response.error))
    .map(({ device }) => device);

  if (retryTargets.length) {
    await wait(PUSH_RETRY_DELAY_MS);
    const retried = [];
    for (const deviceChunk of chunks(retryTargets)) {
      retried.push(...await sendDeviceChunk(messaging, deviceChunk, message));
    }

    const retryByPath = new Map(retried.map((entry) => [entry.device.ref.path, entry]));
    results.forEach((entry, index) => {
      const replacement = retryByPath.get(entry.device.ref.path);
      if (replacement) results[index] = replacement;
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

async function recordLeadDelivery(db, clientId, leadId, summary) {
  const safeLeadId = text(leadId) || `lead-${Date.now()}`;
  const status = summary.sent > 0
    ? "sent"
    : summary.attempted === 0
      ? "no-registered-devices"
      : "failed";
  const errorMessage = text(summary.errorMessage).slice(0, 500);
  const batch = db.batch();

  batch.set(
    db.collection("ocmClients").doc(clientId).collection("notificationDeliveries").doc(safeLeadId),
    {
      type: "new-lead",
      leadId: safeLeadId,
      status,
      attempted: summary.attempted,
      sent: summary.sent,
      failed: summary.failed,
      lastError: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(db.collection("connections").doc(clientId), {
    lastNotificationStatus: status,
    lastNotificationLeadId: safeLeadId,
    lastNotificationAttempted: summary.attempted,
    lastNotificationSent: summary.sent,
    lastNotificationFailed: summary.failed,
    lastNotificationError: errorMessage,
    lastNotificationAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
}

export async function sendNewLeadNotification({ db, clientId, row, leadId }) {
  const devices = await notificationDevices(db, clientId);
  if (!devices.length) {
    const summary = { attempted: 0, sent: 0, failed: 0, errorMessage: "No registered notification devices." };
    await recordLeadDelivery(db, clientId, leadId, summary);
    return summary;
  }

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
      eventId: `lead-${text(leadId)}-${Date.now()}`,
    },
    android: {
      priority: "high",
      ttl: 60 * 60 * 1000,
      notification: {
        channelId: "new-leads",
        sound: "default",
        tag: `lead-${text(leadId)}`,
        defaultVibrateTimings: true,
      },
    },
  });

  const batch = db.batch();
  let sent = 0;
  let failed = 0;
  const errors = [];

  results.forEach(({ device, response }) => {
    if (response.success) {
      sent += 1;
      batch.set(device.ref, {
        unreadLeadCount: FieldValue.increment(1),
        lastLeadAt: FieldValue.serverTimestamp(),
        lastPushAt: FieldValue.serverTimestamp(),
        lastPushError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      failed += 1;
      errors.push(text(response.error?.message || response.error?.code));
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
  const summary = {
    attempted: devices.length,
    sent,
    failed,
    errorMessage: errors.filter(Boolean).join(" | "),
  };
  await recordLeadDelivery(db, clientId, leadId, summary);
  return summary;
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
