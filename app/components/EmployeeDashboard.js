"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

function WorkspaceCard({ href, value, title, description, disabled = false }) {
  const className = disabled
    ? "rounded-3xl border border-slate-300 bg-slate-100 p-5 text-left shadow-sm sm:p-7"
    : "rounded-3xl border border-slate-300 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99] sm:p-7";
  const content = <><p className="text-4xl font-black tracking-tight">{value}</p><h2 className="mt-2 text-sm font-black uppercase tracking-wide text-slate-700">{title}</h2><p className="mt-1 text-xs font-semibold text-slate-400">{description}</p></>;
  return disabled ? <div className={className}>{content}</div> : <Link href={href} className={className}>{content}</Link>;
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
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

  const clientCount = (data?.leads || []).filter((lead) => lead.collectionKey === "clients").length;

  return (
    <main className="ark-dashboard-page min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">Tap a workspace to manage your assigned work.</p>
        </header>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <WorkspaceCard href="/lead-messages" value={loading ? "…" : data?.conversationCount || 0} title="Messages" description={data?.employeeMessagingEnabled ? "Manage conversations" : "Messages are not enabled"} disabled={!data?.employeeMessagingEnabled} />
            <WorkspaceCard href="/employee/leads" value={loading ? "…" : clientCount} title="Clients" description="Manage clients" />
          </div>
        </section>
      </div>
    </main>
  );
}
