import { FieldValue } from "firebase-admin/firestore";
import { isStandardRole } from "./accountRoles";
import { getAdminMessaging } from "./firebase-admin";
import { MESSAGES_AVAILABLE } from "./launchFeatures";
import { PUSH_NOTIFICATION_COPY } from "./notificationCopy";

function text(value) { return String(value || "").trim(); }
function invalidToken(error) {
  return ["messaging/invalid-registration-token", "messaging/registration-token-not-registered", "messaging/invalid-argument"].includes(String(error?.code || ""));
}

export async function sendInboundMessageNotification({ db, clientId, conversationId, conversation }) {
  if (!MESSAGES_AVAILABLE) return { attempted: 0, sent: 0, failed: 0 };
  const businessSnapshot = await db.collection("accounts").doc(clientId).get();
  const business = businessSnapshot.exists ? businessSnapshot.data() : {};
  if (business.messagesEnabled !== true) return { attempted: 0, sent: 0, failed: 0 };

  const devicesSnapshot = await db.collection("accounts").doc(clientId).collection("notificationDevices").get();
  const devices = devicesSnapshot.docs
    .map((document) => ({ ref: document.ref, ...document.data() }))
    .filter((device) => device.notificationsEnabled !== false && text(device.token))
    .filter((device) => isStandardRole(text(device.role)));
  if (!devices.length) return { attempted: 0, sent: 0, failed: 0 };

  const collectionKey = text(conversation.collectionKey) === "clients" ? "clients" : "contactedMe";
  const leadId = text(conversation.leadId);
  const route = `/lead-messages?lead=${encodeURIComponent(leadId)}&collection=${collectionKey}`;
  const messaging = getAdminMessaging();
  const response = await messaging.sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    notification: PUSH_NOTIFICATION_COPY.message,
    data: { type: "lead-message", route, clientId, conversationId, leadId, collectionKey },
    android: { priority: "high", notification: { channelId: "new-leads", sound: "default", tag: `message-${conversationId}`, defaultVibrateTimings: true } },
  });

  const batch = db.batch();
  let sent = 0;
  let failed = 0;
  response.responses.forEach((result, index) => {
    const device = devices[index];
    if (result.success) {
      sent += 1;
      batch.set(device.ref, { unreadMessageCount: FieldValue.increment(1), lastMessageAt: FieldValue.serverTimestamp(), lastMessagePushAt: FieldValue.serverTimestamp(), lastMessagePushError: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      failed += 1;
      if (invalidToken(result.error)) batch.delete(device.ref);
      else batch.set(device.ref, { unreadMessageCount: FieldValue.increment(1), lastMessageAt: FieldValue.serverTimestamp(), lastMessagePushError: text(result.error?.message || result.error?.code), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  await batch.commit();
  return { attempted: devices.length, sent, failed };
}
