"use client";

import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const ALLOWED_PATHS = new Set(["/signup/complete", "/signup/status"]);

function appPath(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "arkclientcenter:" || url.hostname !== "open") return "";
    const path = url.searchParams.get("path") || "/signup/complete";
    if (!ALLOWED_PATHS.has(path)) return "";
    const query = new URLSearchParams();
    for (const key of ["session_id", "handoff", "canceled"]) {
      const item = url.searchParams.get(key);
      if (item) query.set(key, item);
    }
    return `${path}${query.size ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

export default function AppUrlHandler() {
  const router = useRouter();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const open = async ({ url } = {}) => {
      const path = appPath(url);
      if (!path) return;
      await Browser.close().catch(() => null);
      router.replace(path);
    };
    let listener;
    App.getLaunchUrl().then((result) => open(result || {})).catch(() => null);
    App.addListener("appUrlOpen", open).then((handle) => { listener = handle; }).catch(() => null);
    return () => { listener?.remove?.(); };
  }, [router]);
  return null;
}
