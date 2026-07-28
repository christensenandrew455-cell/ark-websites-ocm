"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

function WorkspaceCard({ href, value, title, description, disabled = false }) {
  const className = disabled ? "rounded-3xl border border-slate-200 bg-slate-100 p-5 text-left shadow-sm sm:p-7" : "rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm active:scale-[0.99] sm:p-7";
  const content = <><p className="text-4xl font-black tracking-tight">{value}</p><h2 className="mt-2 text-sm font-black uppercase tracking-wide text-slate-700">{title}</h2><p className="mt-1 text-xs font-semibold text-slate-400">{description}</p></>;
  return disabled ? <div className={className}>{content}</div> : <Link href={href} className={className}>{content}</Link>;
}

export default function EmployeeDashboard() {
  const { user, profile } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/employee-dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load assigned work.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load assigned work.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{data?.businessName || profile?.businessName || "Business"}</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">My Work</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">Assigned to {data?.employeeName || profile?.employeeName || "you"}</p>
          </div>
          <button type="button" onClick={load} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button>
        </header>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
          <WorkspaceCard href="/lead-messages" value={loading ? "…" : data?.conversationCount || 0} title="Messages" description={data?.employeeMessagingEnabled ? "Open assigned conversations" : "The owner has not enabled Messages"} disabled={!data?.employeeMessagingEnabled} />
          <WorkspaceCard href="/employee/leads" value={loading ? "…" : data?.leadCount || 0} title="Leads" description="Open assigned leads and clients" />
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Employee account</p>
          <h2 className="mt-1 text-xl font-black sm:text-2xl">Company and Team</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Open the settings gear to see the company owner, your coworkers, Dark Mode, Terms of Use, and Privacy Policy.</p>
          <Link href="/employee/settings" className="mt-4 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Open Employee Settings</Link>
        </section>
      </div>
    </main>
  );
}
