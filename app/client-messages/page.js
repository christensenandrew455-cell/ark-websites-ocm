"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

async function request(user, path, options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch(path, {
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

function timeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function ClientMessagesPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (lead = selected) => {
    if (!user) return;
    setError("");
    try {
      const query = lead ? `?lead=${encodeURIComponent(lead.id)}&collection=${encodeURIComponent(lead.collectionKey)}` : "";
      const next = await request(user, `/api/business/lead-messages${query}`);
      setData(next);
      if (lead) setSelected(lead);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [user, selected]);

  useEffect(() => {
    if (user) load(null);
  }, [user]);

  const leads = useMemo(() => data?.availableLeads || [], [data]);
  const conversations = useMemo(() => data?.conversations || [], [data]);
  const messages = data?.messages || [];

  async function send(event) {
    event.preventDefault();
    if (!selected || !message.trim() || !user) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(user, "/api/business/lead-messages", {
        method: "POST",
        body: JSON.stringify({ leadId: selected.id, collectionKey: selected.collectionKey, message: message.trim() }),
      });
      setMessage("");
      setNotice("Message sent.");
      await load(selected);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeConversation() {
    if (!selected || !user || !window.confirm(`Delete the conversation with ${selected.name}? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(user, "/api/business/lead-messages/delete", {
        method: "POST",
        body: JSON.stringify({ leadId: selected.id, collectionKey: selected.collectionKey }),
      });
      setSelected(null);
      setNotice("Conversation deleted.");
      await load(null);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-slate-50 p-6">Loading…</main>;
  if (!user) return <main className="min-h-screen bg-slate-50 p-6">Sign in to use Messages.</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Lead messaging</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Messages</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">Text leads and clients from the business number.</p>
        </header>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {notice && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {data && !data.messagingConnected && <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">Messaging is not connected yet. Check Messages settings and the Telnyx business number.</div>}

        <div className="grid gap-3 md:grid-cols-[340px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <h2 className="text-sm font-black">People</h2>
              <button type="button" onClick={() => load(selected)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[10px] font-black">Refresh</button>
            </div>
            <div className="mt-2 max-h-[70vh] space-y-1 overflow-y-auto">
              {leads.map((lead) => {
                const conversation = conversations.find((item) => item.leadId === lead.id && item.collectionKey === lead.collectionKey);
                const active = selected?.id === lead.id && selected?.collectionKey === lead.collectionKey;
                return (
                  <button key={`${lead.collectionKey}:${lead.id}`} type="button" onClick={() => { setSelected(lead); load(lead); }} className={`w-full rounded-xl p-3 text-left ${active ? "bg-slate-950 text-white" : "hover:bg-slate-50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="truncate text-sm font-black">{lead.name}</p><p className={`mt-0.5 truncate text-[11px] font-semibold ${active ? "text-slate-300" : "text-slate-500"}`}>{lead.phone || "No phone"}</p></div>
                      {conversation?.unreadCount > 0 && <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${active ? "bg-white text-slate-950" : "bg-slate-950 text-white"}`}>{conversation.unreadCount}</span>}
                    </div>
                    {conversation?.lastMessage && <p className={`mt-2 truncate text-[11px] ${active ? "text-slate-300" : "text-slate-500"}`}>{conversation.lastMessage}</p>}
                  </button>
                );
              })}
              {leads.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No leads or clients are available for messaging.</p>}
            </div>
          </aside>

          <section className="flex min-h-[560px] flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            {!selected ? (
              <div className="m-auto max-w-sm text-center"><h2 className="text-xl font-black">Choose someone to message</h2><p className="mt-2 text-sm leading-6 text-slate-500">Select a lead or client from the list. Their existing conversation will appear here, or a new one can be started.</p></div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                  <div><h2 className="text-lg font-black">{selected.name}</h2><p className="text-xs font-semibold text-slate-500">{selected.phone || "No phone number"}</p></div>
                  <button type="button" disabled={busy || messages.length === 0} onClick={removeConversation} className="rounded-lg border border-red-300 px-2.5 py-1.5 text-[10px] font-black text-red-700 disabled:opacity-40">Delete conversation</button>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto py-4">
                  {messages.map((item) => (
                    <div key={item.id} className={`flex ${item.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${item.direction === "outbound" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-950"}`}>
                        <p className="whitespace-pre-wrap text-sm leading-5">{item.body}</p>
                        <p className={`mt-1 text-[9px] font-bold ${item.direction === "outbound" ? "text-slate-400" : "text-slate-500"}`}>{timeLabel(item.createdAt)}{item.deliveryStatus && item.direction === "outbound" ? ` · ${item.deliveryStatus}` : ""}</p>
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No messages yet. Send the first text below.</p>}
                </div>

                <form onSubmit={send} className="border-t border-slate-200 pt-3">
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={1600} placeholder="Type a text message…" className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" />
                  <div className="mt-2 flex items-center justify-between gap-3"><p className="text-[10px] font-semibold text-slate-400">{message.length}/1600</p><button disabled={busy || !message.trim() || !selected.phone} className="rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-black text-white disabled:opacity-40">{busy ? "Sending…" : "Send"}</button></div>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
