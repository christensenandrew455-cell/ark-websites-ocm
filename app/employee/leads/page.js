"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";

function Detail({ label, value, wide = false }) {
  if (!value) return null;
  return <div className={wide ? "sm:col-span-2" : ""}><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-800">{value}</p></div>;
}

export default function EmployeeLeadsPage() {
  const { user, profile } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/employee-dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load assigned leads.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load assigned leads.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  const leads = data?.leads || [];

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-3"><Link href="/" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">← Dashboard</Link><button type="button" onClick={load} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button></div>
        <header className="mt-6"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{data?.businessName || profile?.businessName || "Business"}</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><h1 className="text-4xl font-black tracking-tight">Leads</h1><p className="pb-1 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{leads.length.toLocaleString("en-US")} assigned</p></div></header>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        <section className="mt-5 space-y-3">
          {loading && <p className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">Loading assigned leads…</p>}
          {!loading && leads.length === 0 && <p className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No leads or clients are assigned to you yet.</p>}
          {!loading && leads.map((lead) => (
            <article key={`${lead.collectionKey}:${lead.id}`} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="truncate text-xl font-black">{lead.name || "Assigned lead"}</h2><p className="mt-1 text-xs font-black uppercase tracking-wide text-slate-400">{lead.collectionKey === "clients" ? "Client" : "New lead"}</p></div>
                {data?.employeeMessagingEnabled && <Link href={`/lead-messages?lead=${encodeURIComponent(lead.id)}&collection=${encodeURIComponent(lead.collectionKey)}`} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Messages</Link>}
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Detail label="Phone" value={lead.phone} />
                <Detail label="Address" value={lead.address} wide />
                <Detail label="Requested work" value={lead.job} />
                <Detail label="Requested date" value={lead.requestedDate} />
                <Detail label="Requested time" value={lead.requestedTime} />
                <Detail label="Notes" value={lead.notes} wide />
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
