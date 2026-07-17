"use client";

import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
}

export default function NativeAppSetup() {
  const router = useRouter();
  const { user, profile, isAdmin } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user || !profile?.clientId || isAdmin) return undefined;

    let active = true;
    const handles = [];

    async function initialize() {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await createChannels(PushNotifications).catch((channelError) => {
        console.warn("Unable to create notification channels", channelError);
      });

      handles.push(await PushNotifications.addListener("registration", async (registration) => {
        try {
          await updateDevice(user, {
            action: "register",
            token: registration.value,
            platform: Capacitor.getPlatform(),
            appVersion: "1.1",
          });
          if (active) {
            setShowPrompt(false);
            setError("");
          }
        } catch (registrationError) {
          console.error(registrationError);
          if (active) setError(registrationError.message);
        }
      }));

      handles.push(await PushNotifications.addListener("registrationError", (registrationError) => {
        console.error("Push registration failed", registrationError);
        if (active) setError("Notification registration failed. The Android Firebase file may still need to be added to the app build.");
      }));

      handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const route = String(action.notification?.data?.route || "/review-my-clients?section=contacted");
        router.push(route.startsWith("/") ? route : "/review-my-clients?section=contacted");
      }));

      const permission = await PushNotifications.checkPermissions();
      if (!active) return;
      if (permission.receive === "granted") {
        await PushNotifications.register();
      } else {
        setShowPrompt(true);
      }
    }

    initialize().catch((setupError) => {
      console.error("Unable to initialize native notifications", setupError);
      if (active) setError("Notifications are not ready in this app build yet.");
    });

    return () => {
      active = false;
      handles.forEach((handle) => handle.remove().catch(() => null));
    };
  }, [isAdmin, profile?.clientId, router, user]);

  async function enableNotifications() {
    setIsEnabling(true);
    setError("");
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await createChannels(PushNotifications);
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") {
        setError("Notifications were not enabled. You can turn them on later in the phone's app settings.");
        return;
      }
      await PushNotifications.register();
    } catch (enableError) {
      console.error(enableError);
      setError("Could not enable notifications in this app build.");
    } finally {
      setIsEnabling(false);
    }
  }

  if (!Capacitor.isNativePlatform() || !showPrompt || !user || isAdmin) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
      <section className="w-full rounded-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:p-7">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK Client Center</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">Never miss a new client</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Notifications are strongly recommended. The app will alert you immediately when a new lead arrives and remind you when an unread contact is still waiting.
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Calendar and contact access are requested only when you use those actions.
        </p>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setShowPrompt(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-600">Not now</button>
          <button type="button" disabled={isEnabling} onClick={enableNotifications} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{isEnabling ? "Enabling…" : "Enable"}</button>
        </div>
      </section>
    </div>
  );
}
