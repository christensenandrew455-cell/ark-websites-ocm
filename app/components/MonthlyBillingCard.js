"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

function formatMoney(amount = 0, currency = "usd") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(Number(amount || 0) / 100);
  } catch {
    return `$${(Number(amount || 0) / 100).toFixed(2)}`;
  }
}

function UsageCard({ href, label, count, unitCents, totalCents, detail, loading }) {
  return (
    <Link href={href} className="block">
      <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-400 sm:p-5">
        <div className="flex items-start justify-between gap-3"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 sm:text-xs">{label}</p><span className="text-xs font-black text-slate-400">Open →</span></div>
        <p className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{loading ? "…" : count}</p>
        <p className="mt-1 text-xs font-bold text-slate-600">{detail}</p>
        {!loading && <div className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold leading-5 text-slate-600"><p>{formatMoney(unitCents)} each</p><p className="font-black text-slate-900">{formatMoney(totalCents)} this period</p></div>}
      </div>
    </Link>
  );
}

export default function MonthlyBillingCard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/monthly-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not calculate this month's billing.");
      setSummary(data);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not calculate this month's billing.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [load]);

  const cardCount = 1 + (summary?.messagesEnabled ? 1 : 0) + (summary?.employeesEnabled ? 1 : 0);
  return (
    <section className="mx-auto mt-4 max-w-6xl px-3 sm:mt-6 sm:px-5 md:px-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">Current Billing Period</p><p className="mt-1 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{loading ? "…" : formatMoney(summary?.amountDue, summary?.currency)}</p><h2 className="mt-1 text-sm font-black uppercase tracking-wide text-slate-700">Estimated Monthly Total</h2></div>
          {!loading && <div className="rounded-xl bg-slate-100 px-4 py-3 text-xs font-bold leading-5 text-slate-600 sm:text-right"><p>{formatMoney(summary?.monthlyBaseCents, summary?.currency)} monthly account</p><p>+ {formatMoney(summary?.usageCents, summary?.currency)} usage</p></div>}
        </div>

        <div className={`mt-4 grid gap-3 ${cardCount === 3 ? "sm:grid-cols-3" : cardCount === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          <UsageCard href="/?section=contacted" label="Contacted You" count={summary?.callCount ?? 0} unitCents={summary?.perCallCents ?? 200} totalCents={summary?.callUsageCents ?? 0} detail="AI receptionist calls and new leads" loading={loading} />
          {summary?.messagesEnabled && <UsageCard href="/lead-messages" label="Messages" count={summary?.messageCount ?? 0} unitCents={summary?.perMessageConversationCents ?? 100} totalCents={summary?.messageUsageCents ?? 0} detail="new lead conversations" loading={loading} />}
          {summary?.employeesEnabled && <UsageCard href="/employees" label="Employees" count={summary?.employeeCount ?? 0} unitCents={summary?.perEmployeeCents ?? 500} totalCents={summary?.employeeUsageCents ?? 0} detail="active employee accounts" loading={loading} />}
        </div>

        {!loading && <p className="mt-3 text-[11px] font-semibold leading-5 text-slate-500">Your account is $50 per month, plus $2 for each AI receptionist call or lead. Messages are $1 per new lead conversation, and active employees are $5 each when those features are enabled.</p>}
        {error && <p className="mt-3 text-xs font-bold text-red-700">{error}</p>}
      </div>
    </section>
  );
}
