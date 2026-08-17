"use client";

import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";
import ClientStats from "./components/ClientStats";

const PHONE_SETUP_PENDING_KEY = "ark-phone-setup-pending-v1";
const PHONE_PERMISSION_REFRESH_KEY = "ark-phone-permission-refresh-v2";

export default function HomePage() {
  useEffect(() => {
    const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
    if (!isAndroidApp || window.localStorage.getItem(PHONE_PERMISSION_REFRESH_KEY) === "done") return;
    const setupAlreadyPending = window.localStorage.getItem(PHONE_SETUP_PENDING_KEY) === "true";
    window.localStorage.setItem(PHONE_PERMISSION_REFRESH_KEY, "done");
    if (!setupAlreadyPending) {
      window.localStorage.setItem(PHONE_SETUP_PENDING_KEY, "true");
      window.location.reload();
    }
  }, []);

  return <ClientStats />;
}
