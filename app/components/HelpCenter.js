"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import BackButton from "./BackButton";
import { useAuth } from "./AuthProvider";

const CHAT_TTL_MS = 24 * 60 * 60 * 1000;

function makeMessage(role, text, links = []) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    links,
    createdAt: new Date().toISOString(),
  };
}

export default function HelpCenter() {
  const pathname = usePathname();
  const { user } = useAuth();
  const storageKey = useMemo(() => user?.uid ? `ark-help-chat:${user.uid}` : "", [user?.uid]);
  const selfHelpKey = useMemo(() => user?.uid ? `ark-help-self-service:${user.uid}` : "", [user?.uid]);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [expiresAt, setExpiresAt] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setHydrated(false);
    setMessages([]);
    setExpiresAt(0);
    if (!storageKey) {
      setHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) : null;
      if (!saved?.expiresAt || saved.expiresAt <= Date.now() || !Array.isArray(saved.messages)) localStorage.removeItem(storageKey);
      else {
        setMessages(saved.messages);
        setExpiresAt(saved.expiresAt);
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !storageKey) return;
    if (!messages.length) {
      localStorage.removeItem(storageKey);
      setExpiresAt(0);
      return;
    }
    const nextExpiry = Date.now() + CHAT_TTL_MS;
    setExpiresAt(nextExpiry);
    localStorage.setItem(storageKey, JSON.stringify({ messages, expiresAt: nextExpiry }));
  }, [hydrated, messages, storageKey]);

  useEffect(() => {
    if (!expiresAt) return undefined;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      setMessages([]);
      if (storageKey) localStorage.removeItem(storageKey);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setMessages([]);
      setExpiresAt(0);
      if (storageKey) localStorage.removeItem(storageKey);
    }, Math.min(remaining, 2147483647));
    return () => window.clearTimeout(timer);
  }, [expiresAt, storageKey]);

  function clearChat() {
    setMessages([]);
    setInput("");
    setError("");
    setExpiresAt(0);
    if (storageKey) localStorage.removeItem(storageKey);
  }

  async function submitQuestion(event) {
    event.preventDefault();
    const question = input.trim();
    if (!question || sending || !user) return;
    const nextMessages = [...messages, makeMessage("user", question)];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setSending(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPath: pathname, messages: nextMessages.map((message) => ({ role: message.role, text: message.text })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI help is unavailable right now.");
      setMessages((current) => [...current, makeMessage("assistant", data.answer, data.links || [])]);
      if (selfHelpKey) localStorage.setItem(selfHelpKey, String(Date.now()));
    } catch (requestError) {
      setError(requestError.message || "AI help is unavailable right now.");
    } finally {
      setSending(false);
    }
  }

  if (!pathname.startsWith("/help")) return null;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/settings" />
        <header className="mt-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK Client Center</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Help</h1>
        </header>
        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          <Link href="/docs" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400">
            <p className="text-lg font-black">Go to Docs</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Read the full app guide and find where features are located.</p>
          </Link>
          <button type="button" onClick={() => setChatOpen(true)} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-slate-400">
            <p className="text-lg font-black">Ask AI</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Ask how to use ARK Client Center and receive direct page links.</p>
          </button>
          <Link href="/messages" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm hover:border-amber-500">
            <p className="text-lg font-black">Contact Support</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-amber-900">For billing, account, or technical problems that Docs and Ask AI did not solve.</p>
          </Link>
        </section>
      </div>
      {chatOpen && (
        <div className="ark-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="help-chat-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setChatOpen(false); }}>
          <section className="ark-modal-surface flex h-[min(720px,88vh)] max-w-lg flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
              <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">ARK Client Center</p><h2 id="help-chat-title" className="mt-0.5 text-lg font-black text-slate-950 sm:text-xl">Ask AI</h2></div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={clearChat} className="rounded-xl border border-slate-300 px-3 py-2 text-[11px] font-black text-slate-700">Delete Chat</button>
                <button type="button" onClick={() => setChatOpen(false)} aria-label="Close help chat" className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-lg font-black text-white">×</button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900">Ask where something is or how to use the app. AI can explain and provide links, but it cannot change your account or billing. This chat clears 24 hours after the last message.</div>
              <div className="mt-4 space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div className={message.role === "user" ? "max-w-[86%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-sm leading-6 text-white" : "max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm"}>
                      <p className="whitespace-pre-wrap">{message.text}</p>
                      {message.role === "assistant" && message.links?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{message.links.map((link) => <Link key={`${message.id}-${link.href}`} href={link.href} onClick={() => setChatOpen(false)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">{link.label}</Link>)}</div>}
                    </div>
                  </div>
                ))}
                {sending && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500 shadow-sm">Thinking…</div></div>}
              </div>
              {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{error}</p>}
            </div>
            <form onSubmit={submitQuestion} className="border-t border-slate-200 bg-white p-3 sm:p-4">
              <label className="sr-only" htmlFor="help-question">Ask for help</label>
              <div className="flex items-end gap-2">
                <textarea id="help-question" rows={2} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Where do I change my payment method?" className="min-h-12 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950" />
                <button type="submit" disabled={sending || !input.trim()} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40">Send</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
