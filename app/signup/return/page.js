"use client";

import { useEffect, useState } from "react";

const ANDROID_PACKAGE = "com.arkwebsites.clientcenter";

function androidIntentUrl(deepLink, browserFallback) {
  const url = new URL(deepLink);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=arkclientcenter;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(browserFallback)};end`;
}

export default function SignupReturnPage() {
  const [message, setMessage] = useState("Returning to ARK Client Center…");
  const [appUrl, setAppUrl] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");

  useEffect(() => {
    const source = new URLSearchParams(window.location.search);
    const canceled = source.get("canceled") === "1";
    const path = canceled ? "/signup/status" : "/signup/complete";
    const destination = new URL(path, window.location.origin);
    for (const key of ["session_id", "handoff", "canceled"]) {
      const value = source.get(key);
      if (value) destination.searchParams.set(key, value);
    }
    const deepLink = new URL("arkclientcenter://open");
    deepLink.searchParams.set("path", path);
    for (const [key, value] of destination.searchParams) deepLink.searchParams.set(key, value);

    if (source.get("native") !== "1") {
      window.location.replace(destination.toString());
      return undefined;
    }

    const launchUrl = /Android/i.test(window.navigator.userAgent)
      ? androidIntentUrl(deepLink.toString(), destination.toString())
      : deepLink.toString();
    setAppUrl(launchUrl);
    setBrowserUrl(destination.toString());
    setMessage(canceled ? "Return to ARK Client Center" : "Payment method complete");
    const timer = window.setTimeout(() => window.location.assign(launchUrl), 200);
    return () => window.clearTimeout(timer);
  }, []);

  return <main className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><div className="w-full max-w-sm text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/25 border-t-white" /><h1 className="mt-6 text-2xl font-black">{message}</h1><p className="mt-2 text-sm font-semibold leading-6 text-slate-300">Your secure Stripe window is finished. Continue in the ARK app.</p>{appUrl && <button type="button" onClick={() => window.location.assign(appUrl)} className="mt-6 w-full rounded-xl bg-white px-5 py-3.5 text-sm font-black text-slate-950">Open ARK Client Center</button>}{browserUrl && <a href={browserUrl} className="mt-4 inline-block text-xs font-bold text-slate-400 underline">Continue in browser</a>}</div></main>;
}
