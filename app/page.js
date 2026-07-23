"use client";

import { Capacitor } from "@capacitor/core";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./components/AuthProvider";
import { useBillingStatus } from "./components/BillingStatusProvider";
import ClientStats from "./components/ClientStats";
import MonthlyBillingCard from "./components/MonthlyBillingCard";
import ReviewClientsNative from "./components/ReviewClientsNative";

const PHONE_SETUP_PENDING_KEY = "ark-phone-setup-pending-v1";
const PHONE_PERMISSION_REFRESH_KEY = "ark-phone-permission-refresh-v2";
const REVENUE_RANGES = [
  { key: "today", label: "Today", title: "Paid Today" },
  { key: "month", label: "This Month", title: "Paid This Month" },
  { key: "all", label: "All Time", title: "Paid All Time" },
];

async function adminApi(user, url) {
  const token = await user.getIdToken(true);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load the administrator dashboard.");
  return data;
}

function formatMoney(amount = 0, currency = "usd") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currency || "usd").toUpperCase(),
    }).format(Number(amount || 0) / 100);
  } catch {
    return `$${(Number(amount || 0) / 100).toFixed(2)}`;
  }
}

function SummaryCard({ label, value, href }) {
  return (
    <Link href={href} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.99] sm:rounded-3xl sm:p-6">
      <p className="text-3xl font-black tracking-tight sm:text-4xl">{value}</p>
      <h2 className="mt-1 text-xs font-black uppercase tracking-wide text-slate-700 sm:text-sm">{label}</h2>
    </Link>
  );
}

function AdminDashboard({ user }) {
  const [data, setData] = useState(null);
  const [revenueRange, setRevenueRange] = useState("today");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [dashboard, connections] = await Promise.all([
        adminApi(user, "/api/admin/dashboard"),
        adminApi(user, "/api/admin/connections"),
      ]);
      setData({
        ...dashboard,
        counts: {
          ...(dashboard.counts || {}),
          customers: (connections.businesses || []).length,
        },
      });
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  if (isLoading) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading dashboard…</main>;
  }

  const counts = data?.counts || {};
  const totals = data?.stripe?.totals || {};
  const selectedRange = REVENUE_RANGES.find((range) => range.key === revenueRange) || REVENUE_RANGES[0];
  const selectedRevenue = totals[revenueRange] || {};
  const revenueDetail = revenueRange === "all" && data?.stripe?.truncated
    ? "First 10,000 live Stripe payments"
    : "Live Stripe payments only";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex items-end justify-between gap-3 sm:mb-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK OCM Admin</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Dashboard</h1>
          </div>
          <button type="button" onClick={load} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {data?.stripe?.error && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{data.stripe.error}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {REVENUE_RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => setRevenueRange(range.key)}
                className={revenueRange === range.key
                  ? "rounded-lg bg-white px-2 py-2.5 text-[11px] font-black text-slate-950 shadow-sm sm:text-sm"
                  : "rounded-lg px-2 py-2.5 text-[11px] font-bold text-slate-500 sm:text-sm"}
              >
                {range.label}
              </button>
            ))}
          </div>
          <div className="mt-5">
            <p className="text-4xl font-black tracking-tight sm:text-5xl">{formatMoney(selectedRevenue.amount, selectedRevenue.currency)}</p>
            <h2 className="mt-1 text-sm font-black uppercase tracking-wide text-slate-700">{selectedRange.title}</h2>
            <p className="mt-1 text-[10px] font-semibold text-slate-400 sm:text-xs">{revenueDetail}</p>
          </div>
        </section>

        <section className="mt-3 grid grid-cols-3 gap-3 sm:mt-4 sm:gap-4">
          <SummaryCard label="Accounts" value={counts.customers || 0} href="/connections" />
          <SummaryCard label="Messages" value={counts.openRequests || 0} href="/messages" />
          <SummaryCard label="Needs Payment" value={counts.needsPayment || 0} href="/payment" />
        </section>
      </div>
    </main>
  );
}

function CustomerHome() {
  const { status } = useBillingStatus();

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

  return (
    <div className={status.restricted ? "client-home billing-restricted-client-home" : "client-home"}>
      <style>{`
        .client-home main > div > section.mt-4 > div.mt-4.grid.grid-cols-3.rounded-xl { display: none; }
        .client-home section:has(article > div.mt-4.grid.grid-cols-2) > div[class*="max-h-[60vh]"] {
          display: flex;
          flex-direction: column-reverse;
          gap: 0.5rem;
        }
        .client-home section:has(article > div.mt-4.grid.grid-cols-2) > div[class*="max-h-[60vh]"] > * { margin-top: 0 !important; }
        .billing-restricted-client-home main > div > section.grid.grid-cols-2 { grid-template-columns: minmax(0, 1fr); }
        .billing-restricted-client-home main > div > section.grid.grid-cols-2 > button:nth-child(2) { display: none; }
        .billing-restricted-client-home section:has(article > div.mt-4.grid.grid-cols-3) { display: none; }
        .billing-restricted-client-home article > div.mt-4.grid.grid-cols-2 > button:nth-child(2),
        .billing-restricted-client-home article > div.mt-4.grid.grid-cols-2 > button:nth-child(4) { display: none; }
        .billing-restricted-client-home article > div.mt-4.grid.grid-cols-2 > button:nth-child(3) { grid-column: 2; grid-row: 1; }
      `}</style>
      {!status.restricted && <MonthlyBillingCard />}
      {!status.restricted && <ClientStats />}
      <ReviewClientsNative />
    </div>
  );
}

export default function HomePage() {
  const { user, isAdmin, loading } = useAuth();
  if (loading || !user) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading dashboard…</main>;
  return isAdmin ? <AdminDashboard user={user} /> : <CustomerHome />;
}
