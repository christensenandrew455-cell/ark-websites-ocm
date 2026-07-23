"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./components/AuthProvider";
import { useBillingStatus } from "./components/BillingStatusProvider";
import ClientStats from "./components/ClientStats";
import ReviewClientsNative from "./components/ReviewClientsNative";

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

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function SummaryCard({ label, value, detail, href }) {
  const classes = "block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.99] sm:rounded-3xl sm:p-6";
  const content = (
    <>
      <p className="text-3xl font-black tracking-tight sm:text-4xl">{value}</p>
      <h2 className="mt-1 text-xs font-black uppercase tracking-wide text-slate-700 sm:text-sm">{label}</h2>
      {detail && <p className="mt-1 text-[10px] font-semibold leading-4 text-slate-400 sm:text-xs">{detail}</p>}
    </>
  );

  return href ? <Link href={href} className={classes}>{content}</Link> : <div className={classes}>{content}</div>;
}

function QueueSection({ id, title, count, empty, children, tone = "slate", action }) {
  const toneClass = tone === "red"
    ? "border-red-200"
    : tone === "amber"
      ? "border-amber-200"
      : "border-slate-200";
  return (
    <section id={id} className={`scroll-mt-28 rounded-2xl border ${toneClass} bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Needs attention</p>
          <h2 className="mt-1 text-xl font-black sm:text-2xl">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-4 space-y-2">
        {count ? children : <p className="rounded-xl bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">{empty}</p>}
      </div>
    </section>
  );
}

function AdminDashboard({ user }) {
  const [data, setData] = useState(null);
  const [revenueRange, setRevenueRange] = useState("today");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await adminApi(user, "/api/admin/dashboard");
      setData(next);
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
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading today’s work…</main>;
  }

  const counts = data?.counts || {};
  const totals = data?.stripe?.totals || {};
  const paymentIssues = data?.paymentIssues || [];
  const pending = data?.pendingAccounts || [];
  const newRequestCount = (data?.openRequests || []).filter((item) => item.status === "new").length;
  const selectedRange = REVENUE_RANGES.find((range) => range.key === revenueRange) || REVENUE_RANGES[0];
  const selectedRevenue = totals[revenueRange] || {};
  const revenueDetail = revenueRange === "all" && data?.stripe?.truncated
    ? "First 10,000 Stripe charges"
    : data?.stripe?.timeZone || "Stripe successful charges";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex items-end justify-between gap-3 sm:mb-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK OCM Admin</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Today</h1>
            <p className="mt-1 text-xs font-semibold text-slate-500">Oldest unresolved work stays at the top. Finished items disappear from this page.</p>
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
          <SummaryCard label="Accounts" value={counts.customers || 0} detail="All customer accounts" href="/connections" />
          <SummaryCard label="New Accounts" value={pending.length} detail="Waiting for verification or payment" href="#new-accounts" />
          <SummaryCard label="New Requests" value={newRequestCount} detail="Open the request queue" href="/messages" />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2 sm:mt-6">
          <QueueSection
            title="Needs Payment"
            count={paymentIssues.length}
            empty="No overdue payments need attention."
            tone="amber"
            action={<Link href="/connections" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[10px] font-black">Accounts</Link>}
          >
            {paymentIssues.map((item) => (
              <Link key={item.clientId} href={`/connections?clientId=${encodeURIComponent(item.clientId)}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{item.businessName}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{item.ownerName || item.accountEmail}</p>
                  </div>
                  <span className={item.phase === "deletion-review" ? "rounded-full bg-red-100 px-2 py-1 text-[9px] font-black uppercase text-red-700" : item.restricted ? "rounded-full bg-orange-100 px-2 py-1 text-[9px] font-black uppercase text-orange-800" : "rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase text-amber-800"}>{item.phase.replaceAll("-", " ")}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-500">
                  <span>{formatMoney(item.amountDue, item.currency)} due</span>
                  <span>Incident {item.offenseNumber}</span>
                  <span>Failed {formatDate(item.failureAt)}</span>
                </div>
              </Link>
            ))}
          </QueueSection>

          <QueueSection id="new-accounts" title="New Accounts" count={pending.length} empty="No account applications are waiting.">
            {pending.map((item) => (
              <div key={item.uid} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{item.businessName}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{item.ownerName || item.accountEmail}</p>
                  </div>
                  <span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-black uppercase text-violet-800">{item.status === "pending_verification" ? "verify" : "payment setup"}</span>
                </div>
                <p className="mt-2 text-[10px] font-bold text-slate-400">Submitted {formatDate(item.createdAt)}</p>
              </div>
            ))}
          </QueueSection>
        </div>
      </div>
    </main>
  );
}

function CustomerHome() {
  const { status } = useBillingStatus();
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
