"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BackButton from "../components/BackButton";
import { useAuth } from "../components/AuthProvider";

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>;
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function statusLabel(value) { return String(value || "").replaceAll("_", " ").replaceAll("-", " "); }
function failedStatus(value) { return ["provider-error", "sending-failed", "sending_failed", "delivery-failed", "delivery_failed", "failed", "gw-timeout", "gw_timeout", "dlr-timeout", "dlr_timeout"].includes(String(value || "").toLowerCase()); }

async function messageApi(user, query = "", options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch(`/api/business/lead-messages${query}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Something went wrong.");
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
  const [deleting, setDeleting] = useState("");
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
    } catch { setError("Something went wrong."); } finally { if (!silent) setLoading(false); }
  }, [featureEnabled, selectedCollection, selectedLead, user]);

  useEffect(() => { setSelectedLead(requestedLead); setSelectedCollection(requestedCollection); load(requestedLead, requestedCollection); }, [load, requestedCollection, requestedLead]);
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
  const availableLeads = useMemo(() => (data?.availableLeads || []).filter((item) => !existingKeys.has(`${item.collectionKey}:${item.id}`)).sort((a, b) => String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || ""))), [data?.availableLeads, existingKeys]);

  function openConversation(leadId, collectionKey) { setShowContacts(false); setSelectedLead(leadId); setSelectedCollection(collectionKey); router.push(`/lead-messages?lead=${encodeURIComponent(leadId)}&collection=${collectionKey}`); }
  function closeConversation() { setSelectedLead(""); setSelectedCollection("contactedMe"); setMessage(""); router.push("/lead-messages"); }

  async function send(event) {
    event.preventDefault();
    if (!user || !selectedLead || !message.trim() || sending) return;
    if (selected?.messagingOptedOut) { setError("Something went wrong."); return; }
    setSending(true); setNotice(""); setError("");
    try {
      const result = await messageApi(user, "", { method: "POST", body: JSON.stringify({ leadId: selectedLead, collectionKey: selectedCollection, message }) });
      setMessage("");
      if (result.providerError || failedStatus(result.deliveryStatus)) setError("Something went wrong."); else setNotice(result.notice || "Message queued.");
      await load(selectedLead, selectedCollection);
    } catch { setError("Something went wrong."); } finally { setSending(false); }
  }

  async function deleteConversationRecord(leadId, collectionKey, leadName) {
    if (!user || isEmployee || !leadId || deleting) return;
    if (!window.confirm(`Permanently delete the conversation with ${leadName || "this lead"}? This cannot be undone.`)) return;
    const key = `${collectionKey}:${leadId}`;
    setDeleting(key); setNotice(""); setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/lead-messages/delete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ leadId, collectionKey }) });
      if (!response.ok) throw new Error();
      if (selectedLead === leadId && selectedCollection === collectionKey) { setSelectedLead(""); setSelectedCollection("contactedMe"); setMessage(""); router.replace("/lead-messages"); }
      await load("", "contactedMe");
      setNotice("Conversation deleted.");
    } catch { setError("Something went wrong."); } finally { setDeleting(""); }
  }

  if (!featureEnabled) return <main className="min-h-[100dvh] bg-slate-200 p-4"><div className="mx-auto max-w-xl"><BackButton href="/" className="bg-slate-50" /><div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-800">{isEmployee ? "The owner has not enabled Messages for employees." : "You do not currently have Messages turned on. Open Settings to enable it."}</div></div></main>;

  if (selectedLead) {
    const deleteKey = `${selectedCollection}:${selectedLead}`;
    return <main className="h-[100dvh] overflow-hidden bg-slate-200 p-0 text-slate-950 sm:p-4"><div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden bg-slate-50 shadow-sm sm:rounded-3xl sm:border sm:border-slate-300"><div className="shrink-0 border-b border-slate-300 bg-slate-100 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-5 sm:pt-3"><div className="flex min-w-0 items-center gap-2"><BackButton onClick={closeConversation} className="shrink-0 bg-slate-50" label="Back" /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-base font-black sm:text-xl">{selected?.leadName || "Conversation"}</h1>{selected?.messagingOptedOut && <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-[9px] font-black uppercase text-red-700">Opted out</span>}</div><p className="truncate text-[10px] font-bold text-slate-500 sm:text-xs">{selected?.leadPhone || "No phone number"}{selected?.assignedEmployeeName ? ` · Assigned to ${selected.assignedEmployeeName}` : ""}</p></div>{!isEmployee && selected && !selected.newConversation && <button type="button" aria-label="Delete conversation" title="Delete conversation" disabled={Boolean(deleting)} onClick={() => deleteConversationRecord(selectedLead, selectedCollection, selected.leadName)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-300 bg-slate-50 text-red-700 disabled:opacity-50">{deleting === deleteKey ? <span className="text-[10px] font-black">...</span> : <TrashIcon />}</button>}</div></div>{selected?.messagingOptedOut && <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-3 text-xs font-bold leading-5 text-red-700">This customer replied STOP. Sending is disabled until the customer texts START to opt back in.</div>}{notice && <div className="shrink-0 border-b border-green-200 bg-green-50 px-4 py-2 text-xs font-bold text-green-800">{notice}</div>}{error && <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{error}</div>}{loading ? <div className="grid min-h-0 flex-1 place-items-center text-sm font-semibold text-slate-500">Loading conversation…</div> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-200/70 p-4 sm:p-6"><div className="flex min-h-full flex-col justify-end gap-3">{messages.map((item) => { const outbound = item.direction === "outbound"; const failed = outbound && (failedStatus(item.deliveryStatus) || item.providerError); const systemMessage = item.messageType === "opt-in-confirmation"; return <article key={item.id} className={outbound ? `ml-auto max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-white shadow-sm ${systemMessage ? "bg-cyan-800" : "bg-slate-950"}` : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-slate-300 bg-slate-50 px-4 py-3 shadow-sm"}><p className="whitespace-pre-wrap text-sm leading-6">{item.body}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{formatDate(item.createdAt)}{systemMessage ? " · consent notice" : ""}{item.deliveryStatus && outbound ? ` · ${statusLabel(item.deliveryStatus)}` : ""}</p>{failed && <p className="mt-1 text-[10px] font-bold leading-4 text-red-300">Message could not be delivered.</p>}</article>; })}{messages.length === 0 && <div className="m-auto text-center"><p className="text-base font-black text-slate-700">No messages yet</p><p className="mt-1 text-xs text-slate-500">Send the first message to start this chat.</p></div>}</div></div>}<form onSubmit={send} className="shrink-0 border-t border-slate-300 bg-slate-100 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:p-4"><div className="flex items-end gap-2"><textarea required disabled={selected?.messagingOptedOut} rows={2} maxLength={1600} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={selected?.messagingOptedOut ? "Customer opted out" : "Message"} className="max-h-32 min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-950 disabled:bg-slate-200 disabled:text-slate-400" /><button disabled={sending || !selected?.leadPhone || selected?.messagingOptedOut} className="shrink-0 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{sending ? "Sending…" : "Send"}</button></div></form></div></main>;
  }

  return <main className="min-h-[100dvh] bg-slate-200 px-3 py-4 text-slate-950 sm:p-6 md:p-8"><div className="mx-auto max-w-4xl"><div className="flex items-center justify-between gap-3"><BackButton href="/" className="bg-slate-50" /><button type="button" onClick={() => setShowContacts(true)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Contact Someone</button></div><header className="mt-5"><h1 className="text-4xl font-black tracking-tight">Messages</h1><p className="mt-2 text-sm font-semibold text-slate-600">Text clients from your private number.</p><div className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 shadow-sm"><span>{conversations.length.toLocaleString("en-US")} chats</span><span className="text-slate-400">·</span><span>{Number(data?.unreadCount || 0).toLocaleString("en-US")} unread</span></div></header>{notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}{error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}<div className="mt-5 space-y-3">{conversations.map((item) => <button key={`${item.collectionKey}:${item.leadId}`} type="button" onClick={() => openConversation(item.leadId, item.collectionKey)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 p-4 text-left shadow-sm"><h2 className="font-black">{item.leadName || "Conversation"}</h2><p className="mt-1 truncate text-xs font-semibold text-slate-500">{item.lastMessage || "No messages yet"}</p></button>)}{conversations.length === 0 && !loading && <p className="rounded-2xl border border-slate-300 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">No conversations yet.</p>}</div>{showContacts && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3"><button type="button" className="fixed inset-0" onClick={() => setShowContacts(false)} aria-label="Close" /><div className="relative mx-auto my-8 max-w-xl rounded-3xl bg-white p-5"><h2 className="text-2xl font-black">Contact Someone</h2><div className="mt-4 space-y-2">{availableLeads.map((item) => <button key={`${item.collectionKey}:${item.id}`} type="button" onClick={() => openConversation(item.id, item.collectionKey)} className="w-full rounded-xl border border-slate-300 p-3 text-left"><p className="font-black">{item.Name || item.name || "Client"}</p><p className="text-xs text-slate-500">{item.Phone || item.phone || "No phone number"}</p></button>)}{availableLeads.length === 0 && <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-500">No additional contacts are available.</p>}</div></div></div>}</div></main>;
}
