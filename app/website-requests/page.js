"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const OPEN_STATUSES = new Set(["new", "in-progress"]);
const STATUS_LABELS = {
  new: "New",
  "in-progress": "In Progress",
  completed: "Completed",
  denied: "Denied",
};

function formatDate(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function apiFetch(user, url, options = {}) {
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
  if (!response.ok) throw new Error(data.error || "The website request could not be loaded.");
  return data;
}

function StatusBadge({ status }) {
  const style = status === "completed"
    ? "bg-green-100 text-green-800"
    : status === "denied"
      ? "bg-red-100 text-red-700"
      : status === "in-progress"
        ? "bg-blue-100 text-blue-800"
        : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${style}`}>{STATUS_LABELS[status] || "New"}</span>;
}

function ContactLink({ href, children }) {
  if (!children) return null;
  return <a href={href} className="break-all font-black text-blue-700 underline decoration-2 underline-offset-2">{children}</a>;
}

export default function WebsiteRequestsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [requests, setRequests] = useState([]);
  const [view, setView] = useState("open");
  const [notes, setNotes] = useState({});
  const [savingId, setSavingId] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !isAdmin) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await apiFetch(user, "/api/requests?source=public-website&includeClosed=1");
      setRequests(data.requests || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, user]);

  useEffect(() => { if (!loading) load(); }, [load, loading]);

  const openCount = requests.filter((item) => OPEN_STATUSES.has(item.status)).length;
  const visible = useMemo(() => requests.filter((item) => view === "open" ? OPEN_STATUSES.has(item.status) : !OPEN_STATUSES.has(item.status)), [requests, view]);

  async function update(item, status) {
    const adminNote = String(notes[item.id] ?? item.adminNote ?? "").trim();
    if (status === "denied" && !adminNote) {
      setError("Add an internal note before denying a request.");
      return;
    }
    setSavingId(item.id);
    setError("");
    try {
      await apiFetch(user, "/api/requests", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, status, adminNote }),
      });
      await load();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setSavingId("");
    }
  }

  async function downloadAttachment(item) {
    if (!item.attachment?.downloadUrl || attachmentBusy) return;
    setAttachmentBusy(item.id);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch(item.attachment.downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The screenshot could not be opened.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = item.attachment.fileName || "support-screenshot";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (attachmentError) {
      setError(attachmentError.message);
    } finally {
      setAttachmentBusy("");
    }
  }

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading website requests…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Administrator access is required.</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Administrator</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Website Requests</h1>
            <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">Sales, account, privacy, and messaging requests submitted from the public ARK website.</p>
          </div>
          <div className="flex items-center gap-2"><span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-black text-white">{openCount} open</span><button type="button" onClick={load} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button></div>
        </header>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:mt-6">
          {[['open', `Open (${openCount})`], ['history', 'History']].map(([value, label]) => <button key={value} type="button" onClick={() => setView(value)} className={view === value ? "rounded-lg bg-white px-3 py-2.5 text-xs font-black shadow-sm" : "rounded-lg px-3 py-2.5 text-xs font-bold text-slate-500"}>{label}</button>)}
        </div>

        <section className="mt-3 space-y-3 sm:mt-5">
          {visible.map((item) => {
            const isSaving = savingId === item.id;
            const isNew = item.status === "new";
            const isOpen = OPEN_STATUSES.has(item.status);
            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-lg font-black">{item.subject}</h2><span className="rounded-full bg-orange-100 px-2 py-1 text-[9px] font-black uppercase text-orange-800">{item.categoryLabel || item.category || "Website"}</span></div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{item.ownerName || "Website visitor"} · {formatDate(item.createdAt)}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                <dl className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Business</dt><dd className="mt-1 font-bold">{item.businessName || "Not provided"}</dd></div>
                  <div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Contact</dt><dd className="mt-1 space-y-1"><ContactLink href={`mailto:${item.contactEmail}`}>{item.contactEmail}</ContactLink>{item.contactEmail && item.contactPhone && <br />}<ContactLink href={`tel:${item.contactPhone}`}>{item.contactPhone}</ContactLink>{!item.contactEmail && !item.contactPhone && "Not provided"}</dd></div>
                  {item.senderNumber && <div className="sm:col-span-2"><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Number reported</dt><dd className="mt-1"><ContactLink href={`tel:${item.senderNumber}`}>{item.senderNumber}</ContactLink></dd></div>}
                </dl>

                <div className="mt-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Request</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{item.message}</p></div>

                {item.attachment && <button type="button" disabled={attachmentBusy === item.id} onClick={() => downloadAttachment(item)} className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white p-3 text-left text-sm font-black text-slate-800 disabled:opacity-50"><span className="min-w-0 truncate">{attachmentBusy === item.id ? "Opening screenshot…" : `Download screenshot · ${item.attachment.fileName}`}</span><span className="shrink-0 text-xs text-slate-400">{formatBytes(item.attachment.size)}</span></button>}

                <label className="mt-4 block"><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Internal note</span><textarea rows={3} disabled={!isOpen} value={notes[item.id] ?? item.adminNote ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={isNew ? "Optional while starting; required when denying" : "Add what you did or the next step"} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:border-slate-950 disabled:bg-slate-100" /></label>

                {isNew ? <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={isSaving} onClick={() => update(item, "denied")} className="rounded-xl border border-red-300 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Deny</button><button type="button" disabled={isSaving} onClick={() => update(item, "in-progress")} className="rounded-xl bg-blue-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : "Start"}</button></div> : item.status === "in-progress" ? <button type="button" disabled={isSaving} onClick={() => update(item, "completed")} className="mt-3 w-full rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : "Complete"}</button> : null}
              </article>
            );
          })}
          {visible.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500 shadow-sm">{view === "open" ? "No open website requests." : "No closed website requests yet."}</p>}
        </section>
      </div>
    </main>
  );
}
