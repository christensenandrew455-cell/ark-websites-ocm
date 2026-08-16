"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { NOTIFICATION_PREVIEW_CATALOG } from "../lib/notificationPreviewCatalog";

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function NotificationsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [businesses, setBusinesses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [previewQuery, setPreviewQuery] = useState("");

  useEffect(() => {
    if (loading || !user || !isAdmin) {
      if (!loading) setIsLoading(false);
      return;
    }

    let active = true;
    async function load() {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/admin/notifications", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load notification status.");
        if (active) setBusinesses(data.businesses || []);
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [isAdmin, loading, user]);

  const totals = useMemo(() => businesses.reduce((summary, business) => ({
    devices: summary.devices + business.deviceCount,
    enabled: summary.enabled + business.enabledDeviceCount,
    unread: summary.unread + business.unreadLeadCount,
  }), { devices: 0, enabled: 0, unread: 0 }), [businesses]);
  const visiblePreviews = useMemo(() => {
    const query = previewQuery.trim().toLowerCase();
    if (!query) return NOTIFICATION_PREVIEW_CATALOG;
    return NOTIFICATION_PREVIEW_CATALOG.filter((item) => [item.title, item.message, item.category, item.surface]
      .some((value) => String(value).toLowerCase().includes(query)));
  }, [previewQuery]);

  if (loading || isLoading) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading notifications…</main>;
  }

  if (!isAdmin) {
    return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-red-200 bg-white p-7 text-center"><h1 className="text-xl font-black">Administrator access required</h1></div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-7">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Administrator</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Notifications</h1>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">Preview center · {NOTIFICATION_PREVIEW_CATALOG.length} states</p><h2 className="mt-1 text-xl font-black sm:text-2xl">Customer notifications & errors</h2><p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Tap any item to see exactly how that state is presented to a customer.</p></div>
          <label className="mt-4 block"><span className="sr-only">Search notification and error previews</span><input type="search" value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="Search payment, verification, message…" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-700" /></label>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePreviews.map((item) => <button key={item.id} type="button" onClick={() => setSelectedPreview(item)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition active:scale-[0.99]"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500">{item.category}</span><span className="text-[10px] font-bold uppercase text-slate-400">{item.surface}</span></div><h3 className="mt-3 text-sm font-black text-slate-950">{item.title}</h3><p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{item.message}</p></button>)}
            {visiblePreviews.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500 sm:col-span-2 lg:col-span-3">No preview matches that search.</p>}
          </div>
        </section>

        <section className="grid grid-cols-3 gap-2.5 sm:gap-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-6">
            <p className="text-3xl font-black">{totals.devices}</p>
            <h2 className="mt-1 text-xs font-black sm:text-sm">Registered Phones</h2>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-6">
            <p className="text-3xl font-black">{totals.enabled}</p>
            <h2 className="mt-1 text-xs font-black sm:text-sm">Enabled</h2>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-6">
            <p className="text-3xl font-black">{totals.unread}</p>
            <h2 className="mt-1 text-xs font-black sm:text-sm">Unread Alerts</h2>
          </article>
        </section>

        <section className="mt-3 space-y-2 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 lg:grid-cols-3">
          {businesses.map((business) => (
            <article key={business.clientId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-black">{business.businessName}</h2>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{business.ownerName || business.accountEmail || business.clientId}</p>
                </div>
                <span className={business.enabledDeviceCount > 0 ? "h-3 w-3 shrink-0 rounded-full bg-green-500" : "h-3 w-3 shrink-0 rounded-full bg-red-500"} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-black">{business.deviceCount}</p>
                  <p className="text-[9px] font-bold uppercase text-slate-400">Phones</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-black">{business.enabledDeviceCount}</p>
                  <p className="text-[9px] font-bold uppercase text-slate-400">Enabled</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-lg font-black">{business.unreadLeadCount}</p>
                  <p className="text-[9px] font-bold uppercase text-slate-400">Unread</p>
                </div>
              </div>

              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between gap-3"><dt className="font-bold text-slate-400">Last lead</dt><dd className="text-right font-semibold">{formatDate(business.lastLeadAt)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="font-bold text-slate-400">Last push</dt><dd className="text-right font-semibold">{formatDate(business.lastPushAt)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="font-bold text-slate-400">Last reminder</dt><dd className="text-right font-semibold">{formatDate(business.lastReminderAt)}</dd></div>
              </dl>

              {business.deviceCount === 0 && <p className="mt-3 rounded-xl bg-amber-50 p-2 text-[10px] font-bold leading-4 text-amber-800">No phone has registered yet. The customer must install the notification-enabled app, sign in, and allow notifications.</p>}
            </article>
          ))}
          {businesses.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm sm:col-span-2 lg:col-span-3">No customer accounts yet.</p>}
        </section>
      </div>
      {selectedPreview && <div className="fixed inset-0 z-[300] grid place-items-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={() => setSelectedPreview(null)}><section onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{selectedPreview.category} · {selectedPreview.surface}</span><button type="button" onClick={() => setSelectedPreview(null)} aria-label="Close preview" className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 text-xl font-black">×</button></div><div className={selectedPreview.severity === "error" ? "mt-5 rounded-2xl border border-red-200 bg-red-50 p-5" : selectedPreview.severity === "warning" ? "mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5" : selectedPreview.severity === "success" ? "mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" : "mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5"}><h3 id="preview-title" className="text-lg font-black text-slate-950">{selectedPreview.title}</h3><p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{selectedPreview.message}</p>{selectedPreview.actionLabel && <button type="button" onClick={() => setSelectedPreview(null)} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">{selectedPreview.actionLabel}</button>}</div><p className="mt-4 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">Admin preview only</p></section></div>}
    </main>
  );
}
