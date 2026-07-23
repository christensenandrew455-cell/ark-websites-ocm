"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";

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

async function adminFetch(user, url, options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The payment request failed.");
  return data;
}

function CountCard({ label, value, detail }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <p className="text-3xl font-black tracking-tight sm:text-4xl">{value}</p>
      <h2 className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-700 sm:text-xs">{label}</h2>
      <p className="mt-1 text-[10px] font-semibold leading-4 text-slate-500">{detail}</p>
    </div>
  );
}

function AccountDetails({ item }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black sm:text-base">{item.businessName}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{item.ownerName || item.accountEmail}</p>
        </div>
        <p className="shrink-0 text-sm font-black text-slate-950">{formatMoney(item.amountDue, item.currency)}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-500 sm:grid-cols-3 sm:text-xs">
        <span>Incident {item.offenseNumber}</span>
        <span>Failed {formatDate(item.failureAt)}</span>
        <span className="col-span-2 sm:col-span-1">Review {formatDate(item.reviewAt)}</span>
      </div>
    </>
  );
}

function PaymentSection({ title, description, items, empty, renderActions }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <h2 className="text-xl font-black sm:text-2xl">{title}</h2>
      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p>
      <div className="mt-4 space-y-3">
        {items.length ? items.map((item) => (
          <article key={item.clientId} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
            <AccountDetails item={item} />
            {renderActions ? renderActions(item) : (
              <Link href={`/connections?clientId=${encodeURIComponent(item.clientId)}`} className="mt-3 block rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-xs font-black text-slate-700">
                Open Account
              </Link>
            )}
          </article>
        )) : <p className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm font-semibold text-slate-500">{empty}</p>}
      </div>
    </section>
  );
}

export default function PaymentPage() {
  const { user, isAdmin, loading } = useAuth();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !isAdmin) return;
    try {
      const next = await adminFetch(user, "/api/admin/payments");
      setData(next);
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

  async function paymentAction(item, action) {
    setBusyId(item.clientId);
    setNotice("");
    setError("");
    try {
      await adminFetch(user, "/api/admin/payments", {
        method: "POST",
        body: JSON.stringify({ clientId: item.clientId, action }),
      });
      setNotice(action === "snooze"
        ? `${item.businessName} will return to Ready for Deletion in 24 hours if payment is still missing.`
        : `${item.businessName} has full access for another seven days.`);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId("");
    }
  }

  async function deletePermanently(item) {
    if (!window.confirm(`Permanently delete ${item.businessName}? The account and active data cannot be recovered.`)) return;
    const confirmation = window.prompt(`Type ${item.clientId} to permanently delete this account.`) || "";
    if (confirmation !== item.clientId) return;

    setBusyId(item.clientId);
    setNotice("");
    setError("");
    try {
      await adminFetch(user, "/api/admin/customers/lifecycle", {
        method: "POST",
        body: JSON.stringify({
          clientId: item.clientId,
          action: "delete-now",
          confirmation,
          confirmPermanent: true,
        }),
      });
      setNotice(`${item.businessName} was permanently deleted.`);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyId("");
    }
  }

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading payment accounts…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Administrator access required</h1></div></main>;

  const counts = data?.counts || {};
  const grace = data?.grace || [];
  const disabled = data?.disabled || [];
  const ready = data?.ready || [];
  const snoozed = data?.snoozed || [];

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex items-end justify-between gap-3 sm:mb-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Administrator</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Payment</h1>
            <p className="mt-1 text-xs font-semibold text-slate-500">Oldest missed payment stays at the top. Paid accounts disappear automatically.</p>
          </div>
          <button type="button" onClick={load} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl border border-slate-300 bg-white p-3 text-sm font-bold text-slate-800">{notice}</div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
          <CountCard label="Accounts Overdue" value={counts.overdue || 0} detail="All accounts requiring payment attention" />
          <CountCard label="Grace Period" value={counts.grace || 0} detail="Overdue, but full access remains" />
          <CountCard label="Accounts Disabled" value={counts.disabled || 0} detail="Payment-restricted; leads only" />
          <CountCard label="Ready for Deletion" value={counts.ready || 0} detail="Waiting for your decision" />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2 sm:mt-6">
          <PaymentSection
            title="Grace Period"
            description="Payment is overdue, but the account still has full access until its deadline."
            items={grace}
            empty="No accounts are currently in the grace period."
          />
          <PaymentSection
            title="Accounts Disabled"
            description="These accounts are payment-restricted. They can receive and accept leads, but other features are blocked."
            items={disabled}
            empty="No accounts are currently payment-restricted."
          />
          <div className="lg:col-span-2">
            <PaymentSection
              title="Ready for Deletion"
              description="Nothing is deleted automatically. Choose what happens to each account."
              items={ready}
              empty="No accounts are waiting for a deletion decision."
              renderActions={(item) => {
                const busy = busyId === item.clientId;
                return (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Link href={`/connections?clientId=${encodeURIComponent(item.clientId)}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-xs font-black text-slate-700">Open Account</Link>
                    <button type="button" disabled={busy} onClick={() => paymentAction(item, "restore")} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-800 disabled:opacity-50">Restore + 7 Days</button>
                    <button type="button" disabled={busy} onClick={() => paymentAction(item, "snooze")} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-800 disabled:opacity-50">Ask Again in 24 Hours</button>
                    <button type="button" disabled={busy} onClick={() => deletePermanently(item)} className="rounded-xl bg-red-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Delete Permanently</button>
                  </div>
                );
              }}
            />
          </div>
        </div>

        {snoozed.length > 0 && (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-center text-xs font-semibold text-slate-500 shadow-sm">
            {snoozed.length} deletion {snoozed.length === 1 ? "decision is" : "decisions are"} snoozed and will return automatically within 24 hours.
          </p>
        )}
      </div>
    </main>
  );
}
