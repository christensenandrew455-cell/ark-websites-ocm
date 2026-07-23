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
      if (!response.ok) throw new Error(data.error || "Could not calculate this month's amount due.");
      setSummary(data);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not calculate this month's amount due.");
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

  return (
    <section className="mx-auto mt-4 max-w-6xl px-3 sm:mt-6 sm:px-5 md:px-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">This Month</p>
        <p className="mt-1 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{loading ? "…" : formatMoney(summary?.amountDue, summary?.currency)}</p>
        <h2 className="mt-1 text-sm font-black uppercase tracking-wide text-slate-700">Amount Due</h2>
        {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
      </div>
    </section>
  );
}
