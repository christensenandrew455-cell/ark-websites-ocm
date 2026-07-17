"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const STATUS_LABELS = {
  new: "New",
  "in-progress": "In Progress",
  completed: "Completed",
  denied: "Denied",
};

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function apiFetch(user, options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch("/api/requests", {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function StatusBadge({ status }) {
  const classes = status === "completed"
    ? "bg-green-100 text-green-800"
    : status === "denied"
      ? "bg-red-100 text-red-700"
      : status === "in-progress"
        ? "bg-blue-100 text-blue-800"
        : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${classes}`}>{STATUS_LABELS[status] || "New"}</span>;
}

function CustomerMessages({ user, profile, requests, onRefresh }) {
  const [type, setType] = useState("change");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("type");
    if (requested === "help" || requested === "change") setType(requested);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    setError("");
    try {
      await apiFetch(user, {
        method: "POST",
        body: JSON.stringify({ type, subject, message }),
      });
      setSubject("");
      setMessage("");
      setNotice(type === "help"
        ? "Urgent help request sent. It has been marked as priority."
        : "Change request sent. Most changes are reviewed within 1–2 business days.");
      await onRefresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 sm:mb-7">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "Your Business"}</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Requests</h1>
        </header>

        {notice && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setType("change")} className={type === "change" ? "rounded-lg bg-white px-3 py-2.5 text-xs font-black shadow-sm" : "rounded-lg px-3 py-2.5 text-xs font-bold text-slate-500"}>Request Change</button>
            <button type="button" onClick={() => setType("help")} className={type === "help" ? "rounded-lg bg-red-600 px-3 py-2.5 text-xs font-black text-white shadow-sm" : "rounded-lg px-3 py-2.5 text-xs font-bold text-slate-500"}>Request Help</button>
          </div>

          <div className={type === "help" ? "mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-800" : "mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-800"}>
            {type === "help"
              ? "Priority help is only for a broken receptionist, missing lead data, or another issue that is seriously affecting the business. Non-urgent changes submitted here may be denied."
              : "Use this for wording, voice, business information, hours, or other receptionist changes. Most requests take 1–2 business days."}
          </div>

          <label className="mt-4 block">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={type === "help" ? "What is broken?" : "What should change?"} className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
          </label>
          <label className="mt-3 block">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Details</span>
            <textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explain what is happening and what you need." className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" />
          </label>
          <button disabled={sending} className={type === "help" ? "mt-4 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50" : "mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50"}>{sending ? "Sending…" : type === "help" ? "Send Priority Help" : "Send Change Request"}</button>
        </form>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-7">
          <h2 className="text-lg font-black">Your Requests</h2>
          <div className="mt-3 space-y-2">
            {requests.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{item.subject}</p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.type === "help" ? "Priority Help" : "Change"} · {formatDate(item.createdAt)}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.message}</p>
                {item.adminNote && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs font-semibold text-slate-700">ARK: {item.adminNote}</p>}
              </article>
            ))}
            {requests.length === 0 && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No requests yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function AdminMessages({ user, requests, onRefresh }) {
  const [filter, setFilter] = useState("open");
  const [savingId, setSavingId] = useState("");
  const [notes, setNotes] = useState({});
  const [error, setError] = useState("");

  const visible = useMemo(() => requests.filter((item) => {
    if (filter === "all") return true;
    if (filter === "help") return item.type === "help";
    if (filter === "change") return item.type === "change";
    return item.status === "new" || item.status === "in-progress";
  }), [filter, requests]);

  async function update(item, status) {
    setSavingId(item.id);
    setError("");
    try {
      await apiFetch(user, {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, status, adminNote: notes[item.id] ?? item.adminNote }),
      });
      await onRefresh();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setSavingId("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-end justify-between gap-3 sm:mb-7">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Administrator</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Messages</h1>
          </div>
          <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-black text-white">{requests.filter((item) => item.status === "new").length} new</span>
        </header>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
          {[['open', 'Open'], ['help', 'Help'], ['change', 'Changes'], ['all', 'All']].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={filter === value ? "rounded-lg bg-white px-2 py-2 text-[11px] font-black shadow-sm" : "rounded-lg px-2 py-2 text-[11px] font-bold text-slate-500"}>{label}</button>
          ))}
        </div>

        <section className="mt-3 space-y-3 sm:mt-5">
          {visible.map((item) => (
            <article key={item.id} className={item.type === "help" ? "rounded-2xl border border-red-200 bg-white p-4 shadow-sm" : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-black">{item.subject}</h2>
                    <span className={item.type === "help" ? "rounded-full bg-red-100 px-2 py-1 text-[9px] font-black uppercase text-red-700" : "rounded-full bg-blue-100 px-2 py-1 text-[9px] font-black uppercase text-blue-700"}>{item.type === "help" ? "Priority Help" : "Change"}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{item.businessName} · {item.ownerName || item.accountEmail} · {formatDate(item.createdAt)}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.message}</p>
              <textarea rows={2} value={notes[item.id] ?? item.adminNote} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Optional response or internal note" className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-xs outline-none focus:border-slate-950" />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button disabled={savingId === item.id} onClick={() => update(item, "in-progress")} className="rounded-lg border border-blue-300 px-2 py-2 text-[11px] font-black text-blue-700">In Progress</button>
                <button disabled={savingId === item.id} onClick={() => update(item, "completed")} className="rounded-lg bg-green-700 px-2 py-2 text-[11px] font-black text-white">Complete</button>
                <button disabled={savingId === item.id} onClick={() => update(item, "denied")} className="rounded-lg border border-red-300 px-2 py-2 text-[11px] font-black text-red-700">Deny</button>
                <button disabled={savingId === item.id} onClick={() => update(item, "new")} className="rounded-lg border border-slate-300 px-2 py-2 text-[11px] font-black">Reopen</button>
              </div>
            </article>
          ))}
          {visible.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">No requests in this view.</p>}
        </section>
      </div>
    </main>
  );
}

export default function MessagesPage() {
  const { user, profile, isAdmin, loading } = useAuth();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!user) return;
    try {
      const data = await apiFetch(user);
      setRequests(data.requests || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && user) load();
  }, [loading, user]);

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading messages…</main>;
  if (error && requests.length === 0) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div></main>;

  return isAdmin
    ? <AdminMessages user={user} requests={requests} onRefresh={load} />
    : <CustomerMessages user={user} profile={profile} requests={requests} onRefresh={load} />;
}
