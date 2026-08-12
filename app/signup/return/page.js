"use client";

import { useEffect, useState } from "react";

export default function SignupReturnPage() {
  const [message, setMessage] = useState("Returning to ARK Client Center…");

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
    window.location.href = deepLink.toString();
    const timer = window.setTimeout(() => {
      setMessage("Opening account setup in this browser…");
      window.location.replace(destination.toString());
    }, 1600);
    return () => window.clearTimeout(timer);
  }, []);

  return <main className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/25 border-t-white" /><h1 className="mt-6 text-2xl font-black">{message}</h1><p className="mt-2 text-sm font-semibold text-slate-300">Keep this page open for a moment.</p></div></main>;
}
