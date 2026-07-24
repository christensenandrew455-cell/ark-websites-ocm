"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../components/AuthProvider";

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function statusLabel(value) {
  return String(value || "").replaceAll("_", " ").replaceAll("-", " ");
}

function failedStatus(value) {
  return ["provider-error", "sending-failed", "sending_failed", "delivery-failed", "delivery_failed", "failed", "gw-timeout", "gw_timeout", "dlr-timeout", "dlr_timeout"].includes(String(value || "").toLowerCase());
}

async function messageApi(user, query = "", options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch(`/api/business/lead-messages${query}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load messages.");
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
  const [showContacts, setShowContacts] = useState(false);
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
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [featureEnabled, selectedCollection, selectedLead, user]);

  useEffect(() => {
    setSelectedLead(requestedLead);
    setSelectedCollection(requestedCollection);
    load(requestedLead, requestedCollection);
  }, [load, requestedCollection, requestedLead]);

  useEffect(() => {
    if (!featureEnabled) return undefined;
    const timer = window.setInterval(() => load(selectedLead, selectedCollection, true), 15000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(selectedLead, selectedCollection, true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [featureEnabled, load, selectedCollection, selectedLead]);

  const conversations = data?.conversations || [];
  const messages = data?.messages || [];
  const selected = data?.selectedConversation;
  const existingKeys = useMemo(() => new Set(conversations.map((item) => `${item.collectionKey}:${item.leadId}`)), [conversations]);
  const availableLeads = useMemo(() => (data?.availableLeads || [])
    .filter((item) => !existingKeys.has(`${item.collectionKey}:${item.id}`))
    .sort((a, b) => String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || ""))), [data?.availableLeads, existingKeys]);

  function openConversation(leadId, collectionKey) {
    setShowContacts(false);
    setSelectedLead(leadId);
    setSelectedCollection(collectionKey);
    router.push(`/lead-messages?lead=${encodeURIComponent(leadId)}&collection=${collectionKey}`);
  }

  function closeConversation() {
    setSelectedLead("");
    setSelectedCollection("contactedMe");
    setMessage("");
    router.push("/lead-messages");
  }

  async function send(event) {
    event.preventDefault();
    if (!user || !selectedLead || !message.trim() || sending) return;
    setSending(true);
    setNotice("");
    setError("");
    try {
      const result = await messageApi(user, "", { method: "POST", body: JSON.stringify({ leadId: selectedLead, collectionKey: selectedCollection, message }) });
      setMessage("");
      if (result.providerError || failedStatus(result.deliveryStatus)) setError(result.notice || result.providerError || "Telnyx rejected the message.");
      else setNotice(result.notice || "Message queued.");
      await load(selectedLead, selectedCollection);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  if (!featureEnabled) return <main className="min-h-screen bg-slate-50 p-4"><div className="mx-auto max-w-xl"><button type="button" onClick={() => router.push("/")} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black">← Back to Dashboard</button><div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-800">{isEmployee ? "The owner has not enabled Messages for employees." : "You do not currently have Messages turned on. Open Settings to enable it."}</div></div></main>;

  if (selectedLead) {
    return (
      <main className="min-h-screen bg-slate-100 p-0 text-slate-950 sm:p-4">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col overflow-hidden bg-white shadow-sm sm:min-h-[calc(100vh-2rem)] sm:rounded-3xl sm:border sm:border-slate-200">
          <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-3 sm:px-5">
            <button type="button" onClick={closeConversation} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">← Messages</button>
            <div className="min-w-0 flex-1"><h1 className="truncate text-base font-black sm:text-xl">{selected?.leadName || "Conversation"}</h1><p className="truncate text-[10px] font-bold text-slate-500 sm:text-xs">{selected?.leadPhone || "No phone number"}{selected?.assignedEmployeeName ? ` · Assigned to ${selected.assignedEmployeeName}` : ""}</p></div>
          </div>
          {notice && <div className="border-b border-green-200 bg-green-50 px-4 py-2 text-xs font-bold text-green-800">{notice}</div>}
          {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{error}</div>}
          {loading ? <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500">Loading conversation…</div> : <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-slate-50 p-4 sm:p-6">{messages.map((item) => {
            const outbound = item.direction === "outbound";
            const failed = outbound && (failedStatus(item.deliveryStatus) || item.providerError);
            return <article key={item.id} className={outbound ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-white shadow-sm" : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm"}><p className="whitespace-pre-wrap text-sm leading-6">{item.body}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{formatDate(item.createdAt)}{item.deliveryStatus && outbound ? ` · ${statusLabel(item.deliveryStatus)}` : ""}</p>{failed && <p className="mt-1 text-[10px] font-bold leading-4 text-red-300">{item.providerErrorCode ? `${item.providerErrorCode}: ` : ""}{item.providerError || "Telnyx could not deliver this message."}</p>}</article>;
          })}{messages.length === 0 && <div className="m-auto text-center"><p className="text-base font-black text-slate-700">No messages yet</p><p className="mt-1 text-xs text-slate-500">Send the first message to start this chat.</p></div>}</div>}
          <form onSubmit={send} className="border-t border-slate-200 bg-white p-3 sm:p-4"><div className="flex items-end gap-2"><textarea required rows={2} maxLength={1600} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message" className="min-h-12 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950" /><button disabled={sending || !selected?.leadPhone} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{sending ? "Sending…" : "Send"}</button></div></form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3"><button type="button" onClick={() => router.push("/")} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">← Back to Dashboard</button><button type="button" onClick={() => setShowContacts(true)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Contact Someone</button></div>
        <header className="mt-6"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "ARK Client Center"}</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><h1 className="text-4xl font-black tracking-tight">Messages</h1><p className="pb-1 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{conversations.length.toLocaleString("en-US")} chats · {Number(data?.unreadCount || 0).toLocaleString("en-US")} unread</p></div></header>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {!data?.messagingConnected && !loading && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">This business does not have a connected Telnyx messaging number yet.</div>}
        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {loading && <div className="p-8 text-center text-sm font-semibold text-slate-500">Loading chats…</div>}
          {!loading && conversations.length === 0 && <div className="p-10 text-center"><h2 className="text-xl font-black">You have no chats</h2><p className="mt-2 text-sm text-slate-500">Start one from a lead or tap Contact Someone.</p><button type="button" onClick={() => setShowContacts(true)} className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Contact Someone</button></div>}
          {!loading && conversations.map((item) => <button key={item.id} type="button" onClick={() => openConversation(item.leadId, item.collectionKey)} className="flex w-full items-center gap-3 border-b border-slate-100 p-4 text-left last:border-b-0 hover:bg-slate-50"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-black text-slate-700">{String(item.leadName || "?").trim().slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h2 className="truncate text-sm font-black sm:text-base">{item.leadName}</h2><span className="shrink-0 text-[10px] font-bold text-slate-400">{formatDate(item.lastMessageAt)}</span></div><div className="mt-1 flex items-center justify-between gap-3"><p className="truncate text-xs font-semibold text-slate-500">{item.lastMessage || "Conversation started"}</p>{Number(item.unreadCount || 0) > 0 && <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">{item.unreadCount}</span>}</div></div></button>)}
        </section>
      </div>

      {showContacts && <div className="fixed inset-0 z-50 bg-slate-950/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true"><button type="button" className="absolute inset-0" onClick={() => setShowContacts(false)} aria-label="Close" /><div className="relative mx-auto mt-[8vh] max-h-[84vh] max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 p-4"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">New chat</p><h2 className="mt-1 text-xl font-black">Contact Someone</h2></div><button type="button" onClick={() => setShowContacts(false)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button></div><div className="max-h-[65vh] overflow-y-auto p-3">{availableLeads.map((lead) => <button key={`${lead.collectionKey}:${lead.id}`} type="button" onClick={() => openConversation(lead.id, lead.collectionKey)} className="w-full rounded-2xl p-4 text-left hover:bg-slate-100"><h3 className="font-black">{lead.name}</h3><p className="mt-1 truncate text-xs font-semibold text-slate-500">{lead.job || lead.phone || "Lead"}</p></button>)}{availableLeads.length === 0 && <p className="p-8 text-center text-sm font-semibold text-slate-500">Every available lead already has a chat.</p>}</div></div></div>}
    </main>
  );
}
