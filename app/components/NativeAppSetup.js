"use client";

import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

const SETUP_STORAGE_KEY = "arkPhoneAccessSetupV2";

async function updateDevice(user, payload) {
  const token = await user.getIdToken(true);
  const response = await fetch("/api/notifications/device", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not save notification settings.");
  return data;
}

async function createChannels(PushNotifications) {
  await PushNotifications.createChannel({
    id: "new-leads",
    name: "New leads",
    description: "Immediate alerts when a new customer contacts the business.",
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true,
  });
  await PushNotifications.createChannel({
    id: "lead-reminders",
    name: "Lead reminders",
    description: "Reminders when new contacts have not been reviewed yet.",
    importance: 4,
    visibility: 1,
    sound: "default",
    vibration: true,
  });
  await PushNotifications.createChannel({
    id: "request-updates",
    name: "Request updates",
    description: "Updates when an ARK help or change request is started, completed, or denied.",
    importance: 4,
    visibility: 1,
    sound: "default",
    vibration: true,
  });
}

function permissionLabel(value) {
  return value === "granted" || value === "limited" ? "Enabled" : "Not enabled";
}

function PermissionRow({ title, description, status, busy, onEnable }) {
  const enabled = status === "granted" || status === "limited";
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <span className={enabled ? "shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-black uppercase text-green-800" : "shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800"}>
          {permissionLabel(status)}
        </span>
      </div>
      <button
        type="button"
        disabled={busy || enabled}
        onClick={onEnable}
        className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {enabled ? "Enabled" : busy ? "Opening permission…" : `Enable ${title}`}
      </button>
    </div>
  );
}

export default function NativeAppSetup() {
  const router = useRouter();
  const { user, profile, isAdmin } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const [busyPermission, setBusyPermission] = useState("");
  const [permissions, setPermissions] = useState({
    notifications: "prompt",
    calendar: "prompt",
    contacts: "prompt",
  });
  const [foregroundNotification, setForegroundNotification] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user || !profile?.clientId || isAdmin) return undefined;

    let active = true;
    const handles = [];
    const dismissalTimers = [];

    async function initialize() {
      const [{ PushNotifications }, { CapacitorCalendar }, { Contacts }] = await Promise.all([
        import("@capacitor/push-notifications"),
        import("@ebarooni/capacitor-calendar"),
        import("@capacitor-community/contacts"),
      ]);

      await createChannels(PushNotifications).catch((channelError) => {
        console.warn("Unable to create notification channels", channelError);
      });

      handles.push(await PushNotifications.addListener("registration", async (registration) => {
        try {
          await updateDevice(user, {
            action: "register",
            token: registration.value,
            platform: Capacitor.getPlatform(),
            appVersion: "1.3",
          });
          if (active) {
            setPermissions((current) => ({ ...current, notifications: "granted" }));
            setError("");
          }
        } catch (registrationError) {
          console.error(registrationError);
          if (active) setError(registrationError.message);
        }
      }));

      handles.push(await PushNotifications.addListener("registrationError", (registrationError) => {
        console.error("Push registration failed", registrationError);
        if (active) setError("Notification registration failed. Reopen the app and try again.");
      }));

      handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const route = String(action.notification?.data?.route || "/review-my-clients?section=contacted");
        router.push(route.startsWith("/") ? route : "/review-my-clients?section=contacted");
      }));

      handles.push(await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        if (!active) return;
        const id = String(notification.id || `${Date.now()}`);
        const route = String(notification.data?.route || "/review-my-clients?section=contacted");
        setForegroundNotification({
          id,
          title: String(notification.title || "ARK Client Center"),
          body: String(notification.body || "You have a new update."),
          route: route.startsWith("/") ? route : "/review-my-clients?section=contacted",
        });
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate([180, 90, 180]);
        }
        dismissalTimers.push(window.setTimeout(() => {
          if (active) setForegroundNotification((current) => current?.id === id ? null : current);
        }, 10000));
      }));

      const [notificationPermission, calendarPermission, contactPermission] = await Promise.all([
        PushNotifications.checkPermissions(),
        CapacitorCalendar.checkPermission({ scope: "writeCalendar" }).catch(() => ({ result: "prompt" })),
        Contacts.checkPermissions().catch(() => ({ contacts: "prompt" })),
      ]);

      if (!active) return;
      setPermissions({
        notifications: notificationPermission.receive,
        calendar: calendarPermission.result,
        contacts: contactPermission.contacts,
      });

      if (notificationPermission.receive === "granted") {
        await PushNotifications.register();
      }

      if (window.localStorage.getItem(SETUP_STORAGE_KEY) !== "complete") {
        setShowPrompt(true);
      }
    }

    initialize().catch((setupError) => {
      console.error("Unable to initialize native phone access", setupError);
      if (active) {
        setError("Phone access is not ready in this app build yet.");
        setShowPrompt(true);
      }
    });

    return () => {
      active = false;
      dismissalTimers.forEach((timer) => window.clearTimeout(timer));
      handles.forEach((handle) => handle.remove().catch(() => null));
    };
  }, [isAdmin, profile?.clientId, router, user]);

  async function enableNotifications() {
    setBusyPermission("notifications");
    setError("");
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await createChannels(PushNotifications);
      const permission = await PushNotifications.requestPermissions();
      setPermissions((current) => ({ ...current, notifications: permission.receive }));
      if (permission.receive !== "granted") {
        setError("Notifications were not enabled. You can allow them later in the phone's app settings.");
        return;
      }
      await PushNotifications.register();
    } catch (enableError) {
      console.error(enableError);
      setError("Could not enable notifications.");
    } finally {
      setBusyPermission("");
    }
  }

  async function enableCalendar() {
    setBusyPermission("calendar");
    setError("");
    try {
      const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
      const permission = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
      setPermissions((current) => ({ ...current, calendar: permission.result }));
      if (permission.result !== "granted") {
        setError("Calendar access was not enabled. You can allow it later in the phone's app settings.");
      }
    } catch (calendarError) {
      console.error(calendarError);
      setError("Could not request calendar access.");
    } finally {
      setBusyPermission("");
    }
  }

  async function enableContacts() {
    setBusyPermission("contacts");
    setError("");
    try {
      const { Contacts } = await import("@capacitor-community/contacts");
      const permission = await Contacts.requestPermissions();
      setPermissions((current) => ({ ...current, contacts: permission.contacts }));
      if (permission.contacts !== "granted" && permission.contacts !== "limited") {
        setError("Contacts access was not enabled. You can allow it later in the phone's app settings.");
      }
    } catch (contactsError) {
      console.error(contactsError);
      setError("Could not request contacts access.");
    } finally {
      setBusyPermission("");
    }
  }

  function finishSetup() {
    window.localStorage.setItem(SETUP_STORAGE_KEY, "complete");
    setShowPrompt(false);
  }

  if (!Capacitor.isNativePlatform() || !user || isAdmin) return null;

  return (
    <>
      {foregroundNotification && (
        <button
          type="button"
          onClick={() => {
            const route = foregroundNotification.route;
            setForegroundNotification(null);
            router.push(route);
          }}
          className="fixed left-3 right-3 top-[5.25rem] z-[120] mx-auto max-w-md rounded-2xl border border-blue-200 bg-white p-4 text-left shadow-2xl active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">New notification</p>
              <h2 className="mt-1 text-sm font-black text-slate-950">{foregroundNotification.title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">{foregroundNotification.body}</p>
            </div>
            <span className="shrink-0 rounded-full bg-blue-100 px-2 py-1 text-[9px] font-black uppercase text-blue-800">Open</span>
          </div>
        </button>
      )}

      {showPrompt && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm">
          <section className="mx-auto my-4 w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl sm:my-10 sm:p-7">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK Client Center</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Set up phone access</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enable these features so the app can alert you about leads, add estimates to your calendar, and save clients to your contacts.
            </p>

            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div>}

            <div className="mt-5 space-y-3">
              <PermissionRow
                title="Notifications"
                description="Get immediate new-lead alerts and updates about help or change requests."
                status={permissions.notifications}
                busy={busyPermission === "notifications"}
                onEnable={enableNotifications}
              />
              <PermissionRow
                title="Calendar"
                description="Add accepted estimate dates directly to the phone calendar."
                status={permissions.calendar}
                busy={busyPermission === "calendar"}
                onEnable={enableCalendar}
              />
              <PermissionRow
                title="Contacts"
                description="Save a client's name, phone number, email, and address to the phone."
                status={permissions.contacts}
                busy={busyPermission === "contacts"}
                onEnable={enableContacts}
              />
            </div>

            <button type="button" onClick={finishSetup} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
              Finish Setup
            </button>
            <button type="button" onClick={finishSetup} className="mt-2 w-full rounded-xl px-4 py-2 text-xs font-bold text-slate-500">
              Do this later
            </button>
          </section>
        </div>
      )}
    </>
  );
}
