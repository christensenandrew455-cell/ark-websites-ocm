"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

const PhonePermissions = registerPlugin("PhonePermissions");
const PERMISSION_KEYS = ["notifications", "calendar", "contacts"];
const EMPTY_PERMISSIONS = Object.freeze({
  notifications: "unknown",
  calendar: "unknown",
  contacts: "unknown",
});

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

  const channels = [
    {
      id: "new-leads",
      name: "New leads",
      description: "Immediate alerts when a new customer contacts the business.",
      importance: 5,
    },
    {
      id: "lead-reminders",
      name: "Lead reminders",
      description: "Reminders when new contacts have not been reviewed yet.",
      importance: 4,
    },
    {
      id: "request-updates",
      name: "Request updates",
      description: "Updates when an ARK help or change request is started, completed, or denied.",
      importance: 4,
    },
  ];

  await Promise.all(channels.map((channel) => PushNotifications.createChannel({
    ...channel,
    visibility: 1,
    sound: "default",
    vibration: true,
  })));
}

function normalizePermission(value) {
  const normalized = String(value || "unknown").trim().toLowerCase().replaceAll("_", "-");
  if (["granted", "denied", "prompt", "prompt-with-rationale"].includes(normalized)) return normalized;
  return "unknown";
}

function normalizePermissions(result = {}) {
  return {
    notifications: normalizePermission(result.notifications),
    calendar: normalizePermission(result.calendar),
    contacts: normalizePermission(result.contacts),
  };
}

function permissionEnabled(value) {
  return value === "granted";
}

function missingPermissions(permissions) {
  return PERMISSION_KEYS.filter((key) => !permissionEnabled(permissions[key]));
}

function permissionName(key) {
  if (key === "notifications") return "Notifications";
  if (key === "calendar") return "Calendar";
  return "Contacts";
}

function PermissionRow({ permissionKey, title, description, status, busy, onEnable }) {
  if (permissionEnabled(status)) return null;

  const needsSettings = status === "denied";
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
        onClick={() => onEnable(permissionKey)}
        className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {busy ? "Opening permission…" : needsSettings ? `Open ${title} Settings` : `Enable ${title}`}
      </button>
    </div>
  );
}

export default function NativeAppSetup() {
  const router = useRouter();
  const { user, profile, isAdmin } = useAuth();
  const dismissedUntilResume = useRef(false);
  const refreshPermissionsRef = useRef(null);
  const pushPluginRef = useRef(null);
  const registrationRequestedRef = useRef(false);
  const resumeTimerRef = useRef(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busyPermission, setBusyPermission] = useState("");
  const [permissions, setPermissions] = useState(EMPTY_PERMISSIONS);
  const [foregroundNotification, setForegroundNotification] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
    if (!isAndroidApp || !user || !profile?.clientId || isAdmin) return undefined;

    let active = true;
    const handles = [];
    const notificationTimers = [];

    async function registerForPush(knownPermissions) {
      const PushNotifications = pushPluginRef.current;
      if (!PushNotifications || !permissionEnabled(knownPermissions.notifications)) return;
      if (registrationRequestedRef.current) return;

      registrationRequestedRef.current = true;
      try {
        await createChannels(PushNotifications);
        await PushNotifications.register();
      } catch (registrationError) {
        registrationRequestedRef.current = false;
        console.error("Notification registration failed", registrationError);
      }
    }

    async function refreshPermissions({ afterResume = false } = {}) {
      if (afterResume) dismissedUntilResume.current = false;

      if (!Capacitor.isPluginAvailable("PhonePermissions")) {
        if (active) {
          setPermissions(EMPTY_PERMISSIONS);
          setShowPrompt(false);
        }
        return null;
      }

      try {
        const result = await PhonePermissions.check();
        if (!active) return null;

        const nextPermissions = normalizePermissions(result);
        const missing = missingPermissions(nextPermissions);
        setPermissions(nextPermissions);
        setShowPrompt(missing.length > 0 && !dismissedUntilResume.current);
        if (!missing.length) setError("");
        registerForPush(nextPermissions).catch(() => null);
        return nextPermissions;
      } catch (permissionError) {
        console.error("Unable to read native Android permissions", permissionError);
        if (active) setShowPrompt(false);
        return null;
      }
    }

    async function initializePush() {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        pushPluginRef.current = PushNotifications;
        await createChannels(PushNotifications).catch((channelError) => {
          console.warn("Unable to create notification channels", channelError);
        });

        handles.push(await PushNotifications.addListener("registration", async (registration) => {
          try {
            await updateDevice(user, {
              action: "register",
              token: registration.value,
              platform: "android",
              appVersion: "2.0",
            });
          } catch (registrationError) {
            console.error("Unable to save notification token", registrationError);
          }
        }));

        handles.push(await PushNotifications.addListener("registrationError", (registrationError) => {
          registrationRequestedRef.current = false;
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
          notificationTimers.push(window.setTimeout(() => {
            if (active) setForegroundNotification((current) => current?.id === id ? null : current);
          }, 10000));
        }));
      } catch (pushError) {
        console.error("Unable to initialize Android push notifications", pushError);
      }
    }

    function refreshAfterResume() {
      if (document.visibilityState !== "visible") return;
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        refreshPermissionsRef.current?.({ afterResume: true });
      }, 250);
    }

    refreshPermissionsRef.current = refreshPermissions;
    Promise.all([initializePush(), refreshPermissions()]).catch((setupError) => {
      console.error("Unable to initialize Android phone setup", setupError);
    });

    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    window.addEventListener("pageshow", refreshAfterResume);

    return () => {
      active = false;
      refreshPermissionsRef.current = null;
      pushPluginRef.current = null;
      registrationRequestedRef.current = false;
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      notificationTimers.forEach((timer) => window.clearTimeout(timer));
      handles.forEach((handle) => handle?.remove?.().catch(() => null));
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
      window.removeEventListener("pageshow", refreshAfterResume);
    };
  }, [isAdmin, profile?.clientId, router, user]);

  async function enablePermission(permissionKey) {
    setBusyPermission(permissionKey);
    setError("");

    try {
      if (!Capacitor.isPluginAvailable("PhonePermissions")) {
        setShowPrompt(false);
        return;
      }

      const result = await PhonePermissions.request({ permission: permissionKey });
      const nextPermissions = normalizePermissions(result);
      const missing = missingPermissions(nextPermissions);
      setPermissions(nextPermissions);
      setShowPrompt(missing.length > 0);

      if (result.openedSettings) {
        setError(`Android opened the ${permissionName(permissionKey).toLowerCase()} settings. Allow access there, then return to ARK Client Center.`);
      } else if (!permissionEnabled(nextPermissions[permissionKey])) {
        setError(`${permissionName(permissionKey)} was not enabled.`);
      } else {
        setError("");
      }

      if (permissionKey === "notifications" && permissionEnabled(nextPermissions.notifications)) {
        const PushNotifications = pushPluginRef.current;
        if (PushNotifications) {
          registrationRequestedRef.current = false;
          await createChannels(PushNotifications).catch(() => null);
          PushNotifications.register().catch((registrationError) => {
            console.error("Notification registration failed", registrationError);
          });
        }
      }

      window.setTimeout(() => refreshPermissionsRef.current?.(), 300);
    } catch (permissionError) {
      console.error(`Could not request Android ${permissionKey} permission`, permissionError);
      setError(`Could not open the Android ${permissionName(permissionKey).toLowerCase()} permission.`);
    } finally {
      setBusyPermission("");
    }
  }

  function dismissSetup() {
    dismissedUntilResume.current = true;
    setShowPrompt(false);
  }

  const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  if (!isAndroidApp || !user || isAdmin) return null;

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
              Android is checked directly. Only permissions that are currently off are shown below.
            </p>

            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div>}

            <div className="mt-5 space-y-3">
              <PermissionRow
                permissionKey="notifications"
                title="Notifications"
                description="Get immediate new-lead alerts and updates about help or change requests."
                status={permissions.notifications}
                busy={busyPermission === "notifications"}
                onEnable={enablePermission}
              />
              <PermissionRow
                permissionKey="calendar"
                title="Calendar"
                description="Add accepted estimate dates directly to the phone calendar."
                status={permissions.calendar}
                busy={busyPermission === "calendar"}
                onEnable={enablePermission}
              />
              <PermissionRow
                permissionKey="contacts"
                title="Contacts"
                description="Save a client's name, phone number, email, and address to the phone."
                status={permissions.contacts}
                busy={busyPermission === "contacts"}
                onEnable={enablePermission}
              />
            </div>

            <button type="button" onClick={dismissSetup} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
              Done for Now
            </button>
            <p className="mt-2 text-center text-[10px] font-semibold leading-4 text-slate-500">
              ARK Client Center checks Android again whenever the app returns to the foreground.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
