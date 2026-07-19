"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

export default function HelpCenter({ isAdmin = false }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const storageKey = useMemo(() => user?.uid ? `ark-help-chat:${user.uid}` : "", [user?.uid]);
  const [menuOpen, setMenuOpen] = useState(false);
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
      if (!saved?.expiresAt || saved.expiresAt <= Date.now() || !Array.isArray(saved.messages)) {
        localStorage.removeItem(storageKey);
      } else {
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPath: pathname,
          messages: nextMessages.map((message) => ({ role: message.role, text: message.text })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI help is unavailable right now.");
      setMessages((current) => [...current, makeMessage("assistant", data.answer, data.links || [])]);
    } catch (requestError) {
      setError(requestError.message || "AI help is unavailable right now.");
    } finally {
      setSending(false);
    }
  }

  const positionClass = isAdmin ? "top-32 sm:top-24" : "top-20 sm:top-24";

  return (
    <>
      <div className={`fixed right-3 ${positionClass} z-50 sm:right-5 md:right-8`}>
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          aria-expanded={menuOpen}
          className="rounded-full bg-slate-950 px-5 py-2.5 text-xs font-black text-white shadow-lg hover:bg-slate-800 sm:text-sm"
        >
          Help
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
            <Link
              href="/docs"
              onClick={() => setMenuOpen(false)}
              className="block rounded-xl px-3 py-3 text-sm font-black text-slate-950 hover:bg-slate-100"
            >
              Open Docs
              <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">Read the full app guide</span>
            </Link>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); setChatOpen(true); }}
              className="mt-1 block w-full rounded-xl px-3 py-3 text-left text-sm font-black text-slate-950 hover:bg-slate-100"
            >
              Ask AI for Help
              <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">Get directions and page links</span>
            </button>
          </div>
        )}
      </div>

      {chatOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end bg-slate-950/50 sm:items-center sm:justify-center sm:p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setChatOpen(false); }}
        >
          <section className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:h-[min(720px,88vh)] sm:max-w-lg sm:rounded-3xl">
            <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">ARK Client Center</p>
                <h2 className="mt-0.5 text-lg font-black text-slate-950 sm:text-xl">AI Help</h2>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={clearChat} className="rounded-xl border border-slate-300 px-3 py-2 text-[11px] font-black text-slate-700 hover:bg-slate-50">Delete Chat</button>
                <button type="button" onClick={() => setChatOpen(false)} aria-label="Close help chat" className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-lg font-black text-white">×</button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900">
                Ask where something is or how to use the app. AI Help can explain and provide links, but it cannot change your account or billing. This chat clears 24 hours after the last message.
              </div>

              <div className="mt-4 space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div className={message.role === "user"
                      ? "max-w-[86%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-sm leading-6 text-white"
                      : "max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm"}
                    >
                      <p className="whitespace-pre-wrap">{message.text}</p>
                      {message.role === "assistant" && message.links?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.links.map((link) => (
                            <Link
                              key={`${message.id}-${link.href}`}
                              href={link.href}
                              onClick={() => setChatOpen(false)}
                              className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"
                            >
                              {link.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500 shadow-sm">Thinking…</div>
                  </div>
                )}
              </div>

              {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{error}</p>}
            </div>

            <form onSubmit={submitQuestion} className="border-t border-slate-200 bg-white p-3 sm:p-4">
              <label className="sr-only" htmlFor="help-question">Ask for help</label>
              <div className="flex items-end gap-2">
                <textarea
                  id="help-question"
                  rows={2}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Where do I change my payment method?"
                  className="min-h-12 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
                />
                <button type="submit" disabled={sending || !input.trim()} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40">Send</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
