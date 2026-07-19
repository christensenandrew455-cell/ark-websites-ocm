"use client";

import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

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
  if (Capacitor.getPlatform() !== "android") return;

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

function permissionEnabled(value) {
  return value === "granted" || value === "limited";
}

function PermissionRow({ title, description, status, busy, onEnable }) {
  if (permissionEnabled(status)) return null;

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800">
          Not enabled
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onEnable}
        className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {busy ? "Opening permission…" : `Enable ${title}`}
      </button>
    </div>
  );
}

export default function NativeAppSetup() {
  const router = useRouter();
  const { user, profile, isAdmin } = useAuth();
  const dismissedForCurrentOpen = useRef(false);
  const permissionReaderRef = useRef(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busyPermission, setBusyPermission] = useState("");
  const [permissions, setPermissions] = useState({
    notifications: "unknown",
    calendar: "unknown",
    contacts: "unknown",
  });
  const [foregroundNotification, setForegroundNotification] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android" || !user || !profile?.clientId || isAdmin) {
      return undefined;
    }

    let active = true;
    const handles = [];
    const dismissalTimers = [];
    let PushNotifications = null;
    let CapacitorCalendar = null;
    let Contacts = null;

    async function readPermissions() {
      const [notificationPermission, calendarPermission, contactPermission] = await Promise.all([
        PushNotifications
          ? PushNotifications.checkPermissions().catch((permissionError) => {
              console.warn("Unable to read Android notification permission", permissionError);
              return { receive: "denied" };
            })
          : Promise.resolve({ receive: "denied" }),
        CapacitorCalendar
          ? CapacitorCalendar.checkPermission({ scope: "writeCalendar" }).catch((permissionError) => {
              console.warn("Unable to read Android calendar permission", permissionError);
              return { result: "denied" };
            })
          : Promise.resolve({ result: "denied" }),
        Contacts
          ? Contacts.checkPermissions().catch((permissionError) => {
              console.warn("Unable to read Android contacts permission", permissionError);
              return { contacts: "denied" };
            })
          : Promise.resolve({ contacts: "denied" }),
      ]);

      if (!active) return null;

      const nextPermissions = {
        notifications: notificationPermission.receive || "denied",
        calendar: calendarPermission.result || "denied",
        contacts: contactPermission.contacts || "denied",
      };

      setPermissions(nextPermissions);
      const missingPermission = Object.values(nextPermissions).some((value) => !permissionEnabled(value));
      setShowPrompt(missingPermission && !dismissedForCurrentOpen.current);

      if (!missingPermission) setError("");

      if (PushNotifications && permissionEnabled(nextPermissions.notifications)) {
        PushNotifications.register().catch((registrationError) => {
          console.error("Notification registration failed", registrationError);
        });
      }

      return nextPermissions;
    }

    async function initialize() {
      const [pushResult, calendarResult, contactsResult] = await Promise.allSettled([
        import("@capacitor/push-notifications"),
        import("@ebarooni/capacitor-calendar"),
        import("@capacitor-community/contacts"),
      ]);

      PushNotifications = pushResult.status === "fulfilled" ? pushResult.value.PushNotifications : null;
      CapacitorCalendar = calendarResult.status === "fulfilled" ? calendarResult.value.CapacitorCalendar : null;
      Contacts = contactsResult.status === "fulfilled" ? contactsResult.value.Contacts : null;

      if (PushNotifications) {
        await createChannels(PushNotifications).catch((channelError) => {
          console.warn("Unable to create notification channels", channelError);
        });

        handles.push(await PushNotifications.addListener("registration", async (registration) => {
          try {
            await updateDevice(user, {
              action: "register",
              token: registration.value,
              platform: "android",
              appVersion: "1.5",
            });
          } catch (registrationError) {
            console.error("Unable to save notification token", registrationError);
          }
        }));

        handles.push(await PushNotifications.addListener("registrationError", (registrationError) => {
          console.error("Notification registration failed", registrationError);
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
      }

      permissionReaderRef.current = readPermissions;
      dismissedForCurrentOpen.current = false;
      await readPermissions();
    }

    function checkAgainAfterAppReturns() {
      if (document.visibilityState !== "visible") return;
      dismissedForCurrentOpen.current = false;
      permissionReaderRef.current?.();
    }

    initialize().catch((setupError) => {
      console.error("Unable to initialize Android phone access", setupError);
      if (active) {
        setPermissions({ notifications: "denied", calendar: "denied", contacts: "denied" });
        setShowPrompt(true);
      }
    });

    document.addEventListener("visibilitychange", checkAgainAfterAppReturns);
    window.addEventListener("focus", checkAgainAfterAppReturns);
    window.addEventListener("pageshow", checkAgainAfterAppReturns);

    return () => {
      active = false;
      permissionReaderRef.current = null;
      dismissalTimers.forEach((timer) => window.clearTimeout(timer));
      handles.forEach((handle) => handle?.remove?.().catch(() => null));
      document.removeEventListener("visibilitychange", checkAgainAfterAppReturns);
      window.removeEventListener("focus", checkAgainAfterAppReturns);
      window.removeEventListener("pageshow", checkAgainAfterAppReturns);
    };
  }, [isAdmin, profile?.clientId, router, user]);

  async function enableNotifications() {
    setBusyPermission("notifications");
    setError("");

    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await createChannels(PushNotifications).catch((channelError) => {
        console.warn("Unable to create notification channels", channelError);
      });

      let permission = await PushNotifications.checkPermissions();
      if (!permissionEnabled(permission.receive)) {
        permission = await PushNotifications.requestPermissions();
      }

      setPermissions((current) => ({ ...current, notifications: permission.receive }));
      if (!permissionEnabled(permission.receive)) {
        setError("Notifications are blocked. Open Android Settings, choose Apps, ARK Client Center, Notifications, and allow them.");
        return;
      }

      PushNotifications.register().catch((registrationError) => {
        console.error("Notification registration failed", registrationError);
      });
      await permissionReaderRef.current?.();
    } catch (enableError) {
      console.error("Could not request Android notification permission", enableError);
      setError("Notifications are blocked. Open Android Settings, choose Apps, ARK Client Center, Notifications, and allow them.");
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
      if (!permissionEnabled(permission.result)) {
        setError("Calendar access is blocked. Allow it in Android Settings for ARK Client Center.");
        return;
      }
      await permissionReaderRef.current?.();
    } catch (calendarError) {
      console.error("Could not request Android calendar permission", calendarError);
      setError("Calendar access is blocked. Allow it in Android Settings for ARK Client Center.");
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
      if (!permissionEnabled(permission.contacts)) {
        setError("Contacts access is blocked. Allow it in Android Settings for ARK Client Center.");
        return;
      }
      await permissionReaderRef.current?.();
    } catch (contactsError) {
      console.error("Could not request Android contacts permission", contactsError);
      setError("Contacts access is blocked. Allow it in Android Settings for ARK Client Center.");
    } finally {
      setBusyPermission("");
    }
  }

  function dismissSetup() {
    dismissedForCurrentOpen.current = true;
    setShowPrompt(false);
  }

  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android" || !user || isAdmin) return null;

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
          <section className="relative mx-auto my-4 w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl sm:my-10 sm:p-7">
            <button
              type="button"
              onClick={dismissSetup}
              aria-label="Close phone access setup"
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-lg font-black text-slate-600 hover:bg-slate-200"
            >
              ×
            </button>
            <p className="pr-12 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK Client Center</p>
            <h2 className="mt-2 pr-12 text-2xl font-black tracking-tight">Finish phone setup</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Only Android permissions that are currently blocked are shown below.
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

            <button type="button" onClick={dismissSetup} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
              Done for Now
            </button>
            <p className="mt-2 text-center text-[10px] font-semibold leading-4 text-slate-500">
              Blocked permissions will be offered again when the Android app is opened or resumed.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
