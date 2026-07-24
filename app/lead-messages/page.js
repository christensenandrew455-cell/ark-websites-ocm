"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../components/AuthProvider";

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
async function messageApi(user, query = "", options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch(`/api/business/lead-messages${query}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load lead messages.");
  return data;
}

export default function LeadMessagesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, isEmployee } = useAuth();
  const requestedLead = searchParams.get("lead") || "";
  const requestedCollection = searchParams.get("collection") === "clients" ? "clients" : "contactedMe";
  const [data, setData] = useState(null);
  const [selectedLead, setSelectedLead] = useState(requestedLead);
  const [selectedCollection, setSelectedCollection] = useState(requestedCollection);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const featureEnabled = isEmployee ? profile?.employeeMessagingEnabled === true : profile?.messagesEnabled === true;
  const load = useCallback(async (leadId = selectedLead, collectionKey = selectedCollection, silent = false) => {
    if (!user || !featureEnabled) return;
    if (!silent) setLoading(true);
    try {
      const query = leadId ? `?lead=${encodeURIComponent(leadId)}&collection=${encodeURIComponent(collectionKey)}` : "";
      setData(await messageApi(user, query));
      setError("");
    } catch (loadError) { setError(loadError.message); }
    finally { if (!silent) setLoading(false); }
  }, [featureEnabled, selectedCollection, selectedLead, user]);

  useEffect(() => { load(requestedLead, requestedCollection); }, [load, requestedCollection, requestedLead]);
  useEffect(() => {
    if (!featureEnabled) return undefined;
    const timer = window.setInterval(() => load(selectedLead, selectedCollection, true), 15000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(selectedLead, selectedCollection, true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [featureEnabled, load, selectedCollection, selectedLead]);

  if (!featureEnabled) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-800">{isEmployee ? "The owner has not enabled Messages for employees." : "Turn on Messages in Settings to use lead texting."}</div></main>;

  const availableLeads = data?.availableLeads || [];
  const conversations = data?.conversations || [];
  const messages = data?.messages || [];
  const selected = data?.selectedConversation;
  const currentLeadValue = selectedLead ? `${selectedCollection}:${selectedLead}` : "";
  const combinedChoices = useMemo(() => {
    const map = new Map();
    conversations.forEach((item) => map.set(`${item.collectionKey}:${item.leadId}`, { ...item, existing: true }));
    availableLeads.forEach((item) => { const key = `${item.collectionKey}:${item.id}`; if (!map.has(key)) map.set(key, { leadId: item.id, collectionKey: item.collectionKey, leadName: item.name, leadPhone: item.phone, existing: false }); });
    return [...map.values()];
  }, [availableLeads, conversations]);

  function chooseLead(value) {
    if (!value) { setSelectedLead(""); setSelectedCollection("contactedMe"); router.replace("/lead-messages"); load("", "contactedMe"); return; }
    const separator = value.indexOf(":");
    const collectionKey = value.slice(0, separator) === "clients" ? "clients" : "contactedMe";
    const leadId = value.slice(separator + 1);
    setSelectedLead(leadId); setSelectedCollection(collectionKey);
    router.replace(`/lead-messages?lead=${encodeURIComponent(leadId)}&collection=${collectionKey}`);
    load(leadId, collectionKey);
  }

  async function send(event) {
    event.preventDefault();
    if (!user || !selectedLead || !message.trim() || sending) return;
    setSending(true); setNotice(""); setError("");
    try {
      const result = await messageApi(user, "", { method: "POST", body: JSON.stringify({ leadId: selectedLead, collectionKey: selectedCollection, message }) });
      setMessage(""); setNotice(result.notice || "Message saved."); await load(selectedLead, selectedCollection);
    } catch (sendError) { setError(sendError.message); }
    finally { setSending(false); }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8"><div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "ARK Client Center"}</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Messages</h1><p className="mt-2 text-sm leading-6 text-slate-600">A new lead conversation costs $1. Additional texts sent or received inside that same thread are included.</p></div><button type="button" onClick={() => load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button></header>
      {!data?.messagingConnected && !loading && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">Lead conversations work inside ARK, but outbound SMS delivery is not connected yet. Configure the messaging webhook before relying on texts reaching customers.</div>}
      {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

      <section className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><label className="block"><span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Choose a lead</span><select value={currentLeadValue} onChange={(event) => chooseLead(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-slate-950"><option value="">Select a lead or conversation</option>{combinedChoices.map((item) => <option key={`${item.collectionKey}:${item.leadId}`} value={`${item.collectionKey}:${item.leadId}`}>{item.leadName || "Unnamed lead"}{item.existing ? " · conversation" : " · new"}</option>)}</select></label><div className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Recent conversations</p>{Number(data?.unreadCount || 0) > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">{data.unreadCount} new</span>}</div><div className="mt-2 space-y-2">{conversations.map((item) => <button key={item.id} type="button" onClick={() => chooseLead(`${item.collectionKey}:${item.leadId}`)} className={item.leadId === selectedLead && item.collectionKey === selectedCollection ? "w-full rounded-xl bg-slate-950 p-3 text-left text-white" : "w-full rounded-xl border border-slate-200 p-3 text-left hover:border-slate-400"}><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-black">{item.leadName}</p>{Number(item.unreadCount || 0) > 0 && <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">{item.unreadCount}</span>}</div><p className={item.leadId === selectedLead && item.collectionKey === selectedCollection ? "mt-1 truncate text-xs font-semibold text-slate-300" : "mt-1 truncate text-xs font-semibold text-slate-500"}>{item.lastMessage || "Conversation started"}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{formatDate(item.lastMessageAt)}</p></button>)}{!loading && conversations.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-center text-xs font-semibold text-slate-500">No conversations yet.</p>}</div></div></aside>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">{!selected && <div className="grid min-h-[520px] place-items-center p-8 text-center"><div><h2 className="text-2xl font-black">Choose a lead</h2><p className="mt-2 text-sm leading-6 text-slate-500">Start a new conversation or reopen an existing thread.</p></div></div>}{selected && <><div className="border-b border-slate-200 p-4 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Lead conversation</p><h2 className="mt-1 text-xl font-black sm:text-2xl">{selected.leadName}</h2><p className="mt-1 text-xs font-semibold text-slate-500">{selected.leadPhone || "No phone number"}{selected.assignedEmployeeName ? ` · Assigned to ${selected.assignedEmployeeName}` : ""}</p></div>{selected.newConversation && <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase text-amber-800">Starts $1 conversation</span>}</div></div><div className="flex min-h-[360px] max-h-[55vh] flex-col gap-3 overflow-y-auto bg-slate-50 p-4 sm:p-6">{messages.map((item) => <article key={item.id} className={item.direction === "inbound" ? "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white p-3 shadow-sm" : "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-slate-950 p-3 text-white shadow-sm"}><p className="whitespace-pre-wrap text-sm leading-6">{item.body}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{item.senderName || (item.direction === "inbound" ? selected.leadName : "You")} · {formatDate(item.createdAt)}{item.deliveryStatus && item.direction === "outbound" ? ` · ${item.deliveryStatus.replaceAll("-", " ")}` : ""}</p></article>)}{messages.length === 0 && <div className="m-auto text-center"><p className="text-sm font-black text-slate-700">No messages yet</p><p className="mt-1 text-xs text-slate-500">The first message starts this $1 conversation.</p></div>}</div><form onSubmit={send} className="border-t border-slate-200 p-4 sm:p-6"><textarea required rows={3} maxLength={1600} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message to this lead…" className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" /><div className="mt-2 flex items-center justify-between gap-3"><p className="text-[10px] font-semibold text-slate-400">{message.length}/1600</p><button disabled={sending || !selected.leadPhone} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{sending ? "Sending…" : "Send Message"}</button></div></form></>}</div>
      </section>
    </div></main>
  );
}
