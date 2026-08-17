"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";

const STATUS_LABELS = {
  new: "Submitted",
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
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${classes}`}>{STATUS_LABELS[status] || "Submitted"}</span>;
}

function CustomerMessages({ user, requests, onRefresh }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [selfHelpConfirmed, setSelfHelpConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const hasOpenRequest = requests.some((item) => item.status === "new" || item.status === "in-progress");

  useEffect(() => {
    try {
      const lastUsed = Number(localStorage.getItem(`ark-help-self-service:${user.uid}`) || 0);
      if (Date.now() - lastUsed < 24 * 60 * 60 * 1000) setSelfHelpConfirmed(true);
    } catch {
      setSelfHelpConfirmed(false);
    }
  }, [user.uid]);

  async function submit(event) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    setError("");
    try {
      await apiFetch(user, {
        method: "POST",
        body: JSON.stringify({ type: "help", subject, message, selfHelpConfirmed }),
      });
      setSubject("");
      setMessage("");
      setSelfHelpConfirmed(false);
      setNotice("Help request sent. ARK can review it directly from the app.");
      await onRefresh();
    } catch (submitError) {
      setError(ownerFacingError(submitError));
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-transparent px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 sm:mb-7">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Contact ARK</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Help</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use human support for billing, account, or technical problems that the Docs and in-app AI could not solve.</p>
        </header>

        {notice && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
          <p className="text-sm font-black text-blue-950">Please try self-help first</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-blue-900">Most “where is it?” and “how do I?” questions are answered immediately. Human support is for anything still unresolved.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/docs" className="rounded-xl border border-blue-300 bg-white px-3 py-2.5 text-center text-xs font-black text-blue-900">Open Docs</Link>
            <Link href="/help" className="rounded-xl bg-blue-800 px-3 py-2.5 text-center text-xs font-black text-white">Ask AI</Link>
          </div>
        </section>

        {hasOpenRequest && <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">You already have an open help request. Check its status or ARK reply in Help History below before sending another.</div>}

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Subject</span>
            <input required minLength={4} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What still needs human help?" className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
          </label>
          <label className="mt-3 block">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Details</span>
            <textarea required rows={7} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explain what is happening and what you need help with." className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" />
          </label>
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input type="checkbox" checked={selfHelpConfirmed} onChange={(event) => setSelfHelpConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-slate-950" />
            <span className="text-xs font-bold leading-5 text-slate-700">I checked the Docs or asked the in-app AI, and I still need ARK support.</span>
          </label>
          <button disabled={sending || !selfHelpConfirmed || hasOpenRequest} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40">{sending ? "Sending…" : hasOpenRequest ? "Open Request Already Submitted" : "Submit Help Request"}</button>
        </form>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-7">
          <h2 className="text-lg font-black">Your Help History</h2>
          <div className="mt-3 space-y-2">
            {requests.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-black">{item.subject}</p><p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.type === "change" ? "Previous request" : "Help"} · {formatDate(item.createdAt)}</p></div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.message}</p>
                {(item.adminReply || item.adminNote) && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-blue-700">ARK reply</p><p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5 text-blue-950">{item.adminReply || item.adminNote}</p></div>}
              </article>
            ))}
            {requests.length === 0 && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No help requests yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}


export default function MessagesPage() {
  const { user, loading } = useAuth();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch(user);
      setRequests(data.requests || []);
      setError("");
    } catch (loadError) {
      setError(ownerFacingError(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!loading && user) load();
  }, [load, loading, user]);

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading messages…</main>;
  if (error && requests.length === 0) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div></main>;
  return <CustomerMessages user={user} requests={requests} onRefresh={load} />;
}
