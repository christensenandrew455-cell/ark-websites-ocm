"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

function Detail({ label, value, wide = false }) {
  if (!value) return null;
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
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
      const response = await fetch("/api/business/employee-dashboard", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
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

  const leads = data?.leads || [];
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

        <section className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
          <Link href="/lead-messages" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm active:scale-[0.99] sm:p-7">
            <p className="text-4xl font-black tracking-tight">{loading ? "…" : data?.conversationCount || 0}</p>
            <h2 className="mt-2 text-sm font-black uppercase tracking-wide text-slate-700">Messages</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">Assigned conversations</p>
          </Link>
          <a href="#assigned-leads" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm active:scale-[0.99] sm:p-7">
            <p className="text-4xl font-black tracking-tight">{loading ? "…" : data?.leadCount || 0}</p>
            <h2 className="mt-2 text-sm font-black uppercase tracking-wide text-slate-700">Leads</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">Assigned work</p>
          </a>
        </section>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section id="assigned-leads" className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Assigned work</p><h2 className="mt-1 text-xl font-black sm:text-2xl">Leads and Clients</h2></div>
            <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">{leads.length}</span>
          </div>
          <div className="mt-4 space-y-3">
            {loading && <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">Loading assigned work…</p>}
            {!loading && leads.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">No work is assigned to you yet.</p>}
            {leads.map((lead) => (
              <article key={`${lead.collectionKey}:${lead.id}`} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate text-lg font-black">{lead.name || "Assigned lead"}</h3><p className="mt-1 text-xs font-black uppercase tracking-wide text-slate-400">{lead.collectionKey === "clients" ? "Client" : "New lead"}</p></div>
                  <Link href={`/lead-messages?lead=${encodeURIComponent(lead.id)}&collection=${encodeURIComponent(lead.collectionKey)}`} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Messages</Link>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Detail label="Phone" value={lead.phone} />
                  <Detail label="Email" value={lead.email} />
                  <Detail label="Address" value={lead.address} wide />
                  <Detail label="Requested work" value={lead.job} />
                  <Detail label="Requested date" value={lead.requestedDate} />
                  <Detail label="Requested time" value={lead.requestedTime} />
                  <Detail label="Notes" value={lead.notes} wide />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
