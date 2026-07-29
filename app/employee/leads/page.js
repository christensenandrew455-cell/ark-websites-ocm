"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BackButton from "../../components/BackButton";
import { useAuth } from "../../components/AuthProvider";

function Detail({ label, value, wide = false }) {
  if (!value) return null;
  return <div className={wide ? "sm:col-span-2" : ""}><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-800">{value}</p></div>;
}

function ClientCard({ client, messagingEnabled }) {
  return (
    <article className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-black">{client.name || "Assigned client"}</h3>
        </div>
        {messagingEnabled && <Link href={`/lead-messages?lead=${encodeURIComponent(client.id)}&collection=clients`} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Chat</Link>}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detail label="Phone" value={client.phone} />
        <Detail label="Address" value={client.address} wide />
        <Detail label="Requested work" value={client.job} />
        <Detail label="Requested date" value={client.requestedDate} />
        <Detail label="Requested time" value={client.requestedTime} />
        <Detail label="Notes" value={client.notes} wide />
      </div>
    </article>
  );
}

export default function EmployeeClientsPage() {
  const { user } = useAuth();
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
      if (!response.ok) throw new Error(body.error || "Could not load assigned clients.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load assigned clients.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  const clients = (data?.leads || []).filter((lead) => lead.collectionKey === "clients");

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <BackButton href="/" />
        <header className="mt-6"><h1 className="text-4xl font-black tracking-tight">Clients</h1></header>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5">
          <div className="space-y-3">
            {loading && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">Loading clients…</p>}
            {!loading && clients.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No clients are assigned to you yet.</p>}
            {!loading && clients.map((client) => <ClientCard key={client.id} client={client} messagingEnabled={data?.employeeMessagingEnabled === true} />)}
          </div>
        </section>
      </div>
    </main>
  );
}
