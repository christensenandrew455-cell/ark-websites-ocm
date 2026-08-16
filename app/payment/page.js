"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function adminFetch(user) {
  const token = await user.getIdToken(true);
  const response = await fetch("/api/admin/payments", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The payment request failed.");
  return data;
}

function CountCard({ label, value, detail }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6"><p className="text-3xl font-black tracking-tight sm:text-4xl">{value}</p><h2 className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-700 sm:text-xs">{label}</h2><p className="mt-1 text-[10px] font-semibold leading-4 text-slate-500">{detail}</p></div>;
}

function AccountDetails({ item }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black sm:text-base">{item.businessName}</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{item.ownerName || item.accountEmail}</p></div><span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-800">Disabled</span></div><dl className="mt-3 grid gap-2 text-[10px] font-bold text-slate-500 sm:grid-cols-3 sm:text-xs"><div><dt className="uppercase text-slate-400">Payment failed</dt><dd className="mt-0.5 text-slate-700">{formatDate(item.failureAt)}</dd></div><div><dt className="uppercase text-slate-400">Next retry</dt><dd className="mt-0.5 text-slate-700">{formatDate(item.retryAt)}</dd></div><div><dt className="uppercase text-slate-400">Automatic deletion</dt><dd className="mt-0.5 text-slate-700">{formatDate(item.recoveryEndsAt)}</dd></div></dl><Link href={`/connections?clientId=${encodeURIComponent(item.clientId)}`} className="mt-3 block rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-xs font-black text-slate-700">Open Account</Link></article>;
}

function PaymentSection({ title, description, items, empty }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black sm:text-2xl">{title}</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p></div><span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">{items.length}</span></div><div className="mt-4 space-y-3">{items.length ? items.map((item) => <AccountDetails key={item.clientId} item={item} />) : <p className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm font-semibold text-slate-500">{empty}</p>}</div></section>;
}

export default function PaymentPage() {
  const { user, isAdmin, loading } = useAuth();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !isAdmin) return;
    try {
      setData(await adminFetch(user));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    if (loading || !user || !isAdmin) {
      if (!loading) setIsLoading(false);
      return undefined;
    }
    load();
    const interval = window.setInterval(load, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [isAdmin, load, loading, user]);

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading payment accounts…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Administrator access required</h1></div></main>;

  const counts = data?.counts || {};
  const retrying = data?.retrying || [];
  const deletionDue = data?.deletionDue || [];
  return <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8"><div className="mx-auto max-w-7xl"><header className="mb-4 flex items-end justify-between gap-3 sm:mb-7"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Administrator</p><h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Payment</h1><p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">A declined payment disables service immediately. ARK retries no more than once per day and permanently deletes an unpaid account after seven days.</p></div><button type="button" onClick={load} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button></header>{error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}<section className="grid max-w-2xl grid-cols-3 gap-3"><CountCard label="Payment Failed" value={counts.overdue || 0} detail="All disabled payment accounts" /><CountCard label="Retrying" value={counts.retrying || 0} detail="Inside the seven-day window" /><CountCard label="Deletion Due" value={counts.deletionDue || 0} detail="Removed by the daily workflow" /></section><div className="mt-4 grid gap-4 lg:grid-cols-2 sm:mt-6"><PaymentSection title="Disabled & Retrying" description="Receptionist, new leads, and chats stay off while ARK retries the saved payment method daily." items={retrying} empty="No accounts are waiting for a payment retry." /><PaymentSection title="Deletion Due" description="These accounts reached seven days and will be permanently removed by the enforcement workflow." items={deletionDue} empty="No accounts have reached the deletion deadline." /></div></div></main>;
}
