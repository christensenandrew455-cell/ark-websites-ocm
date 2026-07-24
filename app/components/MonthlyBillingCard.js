"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

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

function UsageCard({ label, remaining, included, used, overageCount, overageCents, loading }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 sm:text-xs">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{loading ? "…" : remaining}</p>
      <p className="mt-1 text-xs font-bold text-slate-600">free remaining out of {included}</p>
      {!loading && (
        <div className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold leading-5 text-slate-600">
          <p>{used} used this month</p>
          <p>{overageCount} overage · {formatMoney(overageCents)}</p>
        </div>
      )}
    </div>
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
      const response = await fetch("/api/billing/monthly-summary", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
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
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const conversationsEnabled = summary?.conversationsEnabled === true;

  return (
    <section className="mx-auto mt-4 max-w-6xl px-3 sm:mt-6 sm:px-5 md:px-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">Current Billing Period · {loading ? "Loading plan" : summary?.planName || "Solo"}</p>
            <p className="mt-1 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{loading ? "…" : formatMoney(summary?.amountDue, summary?.currency)}</p>
            <h2 className="mt-1 text-sm font-black uppercase tracking-wide text-slate-700">Estimated Monthly Total</h2>
          </div>
          {!loading && (
            <div className="rounded-xl bg-slate-100 px-4 py-3 text-xs font-bold leading-5 text-slate-600 sm:text-right">
              <p>{formatMoney(summary?.monthlyBaseCents, summary?.currency)} plan</p>
              <p>+ {formatMoney(summary?.overageCents, summary?.currency)} overage</p>
            </div>
          )}
        </div>

        <div className={`mt-4 grid gap-3 ${conversationsEnabled ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          <UsageCard
            label="Leads"
            remaining={summary?.freeLeadsRemaining ?? 50}
            included={summary?.includedLeads ?? 50}
            used={summary?.leadCount ?? 0}
            overageCount={summary?.leadOverageCount ?? 0}
            overageCents={summary?.leadOverageCents ?? 0}
            loading={loading}
          />
          {conversationsEnabled && (
            <UsageCard
              label="New Lead Conversations"
              remaining={summary?.freeConversationsRemaining ?? 50}
              included={summary?.includedConversations ?? 50}
              used={summary?.conversationCount ?? 0}
              overageCount={summary?.conversationOverageCount ?? 0}
              overageCents={summary?.conversationOverageCents ?? 0}
              loading={loading}
            />
          )}
        </div>

        {!loading && (
          <p className="mt-3 text-[11px] font-semibold leading-5 text-slate-500">
            Each extra lead is {formatMoney(summary?.perOverageCents, summary?.currency)} after the 50 included leads.
            {conversationsEnabled ? " Solo Pro also charges $5 only when a new lead conversation starts after the 50 included conversations; additional texts inside that same conversation are included." : ""}
          </p>
        )}
        {error && <p className="mt-3 text-xs font-bold text-red-700">{error}</p>}
      </div>
    </section>
  );
}
