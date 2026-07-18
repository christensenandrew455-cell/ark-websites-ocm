"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "./components/AuthProvider";
import ClientStats from "./components/ClientStats";
import ReviewClientsNative from "./components/ReviewClientsNative";

async function adminApi(user, url) {
  const token = await user.getIdToken(true);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load the administrator dashboard.");
  return data;
}

function AdminDashboard({ user }) {
  const [metrics, setMetrics] = useState({ openMessages: 0, customers: 0, disabled: 0, scheduled: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      adminApi(user, "/api/requests"),
      adminApi(user, "/api/admin/connections"),
    ])
      .then(([requestData, connectionData]) => {
        if (!active) return;
        const requests = requestData.requests || [];
        const businesses = connectionData.businesses || [];
        setMetrics({
          openMessages: requests.filter((item) => item.status === "new" || item.status === "in-progress").length,
          customers: businesses.length,
          disabled: businesses.filter((item) => item.status === "disabled").length,
          scheduled: businesses.filter((item) => item.deletionScheduledFor).length,
        });
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [user]);

  const cards = [
    { href: "/messages", value: metrics.openMessages, title: "Open Messages", detail: "Help and change requests waiting for your attention." },
    { href: "/connections", value: metrics.customers, title: "Connections", detail: "Customer accounts and receptionist connections." },
    { href: "/connections", value: metrics.disabled, title: "Disabled", detail: "Accounts currently blocked from login and receptionist intake." },
    { href: "/connections", value: metrics.scheduled, title: "Deletion Scheduled", detail: "Disabled accounts waiting for permanent removal." },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-7"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK OCM Admin</p><h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Dashboard</h1></header>
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {isLoading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading administrator dashboard…</div> : (
          <section className="grid grid-cols-2 gap-3 sm:gap-5">
            {cards.map((card) => (
              <Link key={`${card.href}:${card.title}`} href={card.href} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.99] sm:rounded-3xl sm:p-7">
                <p className="text-4xl font-black sm:text-5xl">{card.value}</p>
                <h2 className="mt-1 text-sm font-black sm:text-xl">{card.title}</h2>
                <p className="mt-2 text-[10px] font-semibold leading-4 text-slate-500 sm:text-sm sm:leading-6">{card.detail}</p>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function CustomerHome() {
  return (
    <div className="client-home">
      <style>{`
        .client-home main > div > section.mt-4 > div.mt-4.grid.grid-cols-3.rounded-xl {
          display: none;
        }
      `}</style>
      <ReviewClientsNative />
      <ClientStats />
    </div>
  );
}

export default function HomePage() {
  const { user, isAdmin, loading } = useAuth();
  if (loading || !user) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading dashboard…</main>;
  return isAdmin ? <AdminDashboard user={user} /> : <CustomerHome />;
}
