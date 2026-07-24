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

function planPriceLine(plan) {
  if (!plan) return "";
  return `${formatMoney(plan.monthlyCents)}/month · ${plan.includedCalls.toLocaleString()} calls · ${formatMoney(plan.overageCents)} overage`;
}

function PlanOption({ option, pendingKey, busyKey, onChoose }) {
  const selected = pendingKey === option.key;
  return (
    <article className={option.recommended ? "rounded-2xl border-2 border-slate-950 bg-white p-4" : "rounded-2xl border border-slate-200 bg-white p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{option.label}</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">{option.name}</h3>
        </div>
        {option.recommended && <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[9px] font-black uppercase text-white">Best fit</span>}
      </div>
      <p className="mt-3 text-sm font-black text-slate-900">{formatMoney(option.monthlyCents)}/month</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{option.includedCalls.toLocaleString()} included calls, then {formatMoney(option.overageCents)} per completed call.</p>
      <p className="mt-2 text-xs font-bold text-slate-700">Estimated at last month&apos;s usage: {formatMoney(option.estimatedTotalCents)}</p>
      <button
        type="button"
        onClick={() => onChoose(option.key)}
        disabled={Boolean(busyKey) || selected}
        className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-300"
      >
        {busyKey === option.key ? "Scheduling…" : selected ? "Scheduled" : "Use next month"}
      </button>
    </article>
  );
}

export default function MonthlyBillingCard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
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
      if (!response.ok) throw new Error(data.error || "Could not calculate this month's amount due.");
      setSummary(data);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not calculate this month's amount due.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  async function choosePlan(planKey) {
    if (!user || busyKey) return;
    setBusyKey(planKey);
    setNotice("");
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/monthly-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not schedule that plan.");
      setSummary(data);
      setNotice(data.message || "Plan scheduled.");
    } catch (planError) {
      setError(planError.message || "Could not schedule that plan.");
    } finally {
      setBusyKey("");
    }
  }

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

  const includedCalls = Math.max(1, Number(summary?.plan?.includedCalls || 25));
  const callsUsed = Math.max(0, Number(summary?.callsUsed || 0));
  const progress = Math.min(100, (callsUsed / includedCalls) * 100);
  const pendingKey = summary?.pendingPlan?.key || "";

  return (
    <section className="mx-auto mt-4 max-w-6xl px-3 sm:mt-6 sm:px-5 md:px-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">This Month</p>
            <p className="mt-1 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{loading ? "…" : formatMoney(summary?.amountDue, summary?.currency)}</p>
            <h2 className="mt-1 text-sm font-black uppercase tracking-wide text-slate-700">Estimated amount due</h2>
            <p className="mt-2 text-xs font-semibold text-slate-500">{loading ? "Loading your plan…" : planPriceLine(summary?.plan)}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:min-w-[360px]">
            <div className="rounded-xl bg-slate-100 p-3">
              <p className="text-[9px] font-black uppercase tracking-wide text-slate-500">Calls remaining</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{loading ? "—" : Number(summary?.callsRemaining || 0).toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <p className="text-[9px] font-black uppercase tracking-wide text-slate-500">Overage so far</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{loading ? "—" : formatMoney(summary?.overageAmount, summary?.currency)}</p>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 text-xs font-black text-slate-700">
            <span>{callsUsed.toLocaleString()} of {includedCalls.toLocaleString()} included calls used</span>
            <span>{Number(summary?.overageCalls || 0).toLocaleString()} overage</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Monthly included calls" aria-valuemin={0} aria-valuemax={includedCalls} aria-valuenow={Math.min(callsUsed, includedCalls)}>
            <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {summary?.pendingPlan && (
          <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-bold text-slate-700">
            {summary.pendingPlan.name} is scheduled for {summary.pendingPlan.effectiveMonth}. Your current plan stays locked through this month.
          </div>
        )}
        {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-bold text-green-700">{notice}</div>}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}

        {!loading && !summary?.firstMonthComplete && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-black text-slate-950">Starter month</h3>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">Every account begins at the lowest plan. After this first full month, ARK will use your completed-call total to show a lower-monthly option, the recommended option, and a lower-overage option.</p>
          </div>
        )}

        {!loading && summary?.firstMonthComplete && summary?.recommendations?.length > 0 && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Next-month choices</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">Based on {Number(summary.recommendationCallCount || 0).toLocaleString()} calls in {summary.recommendationMonthKey}</h3>
              </div>
              <p className="max-w-md text-xs font-semibold leading-5 text-slate-500">Choosing a plan never changes the current month or removes already recorded overage.</p>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {summary.recommendations.map((option) => (
                <PlanOption key={option.key} option={option} pendingKey={pendingKey} busyKey={busyKey} onChoose={choosePlan} />
              ))}
            </div>
            {summary.customPricingRecommended && <p className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-bold text-slate-700">Your usage is above 1,000 completed calls. The Scale 1000 plan remains available, but ARK may offer a custom high-volume rate.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
