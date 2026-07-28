"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function destinationLabel(href) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.pathname === "/") return "Dashboard";
    if (url.pathname === "/settings") return "Settings";
    if (url.pathname === "/employee/settings") return "Employee Settings";
    if (url.pathname === "/employee/leads") return "Leads";
    if (url.pathname === "/lead-messages") return "Messages";
    return "the next page";
  } catch {
    return "the next page";
  }
}

export function requestUnsavedNavigation(label, action) {
  if (typeof window !== "undefined" && window.__arkUnsavedGuard?.dirty) {
    window.__arkUnsavedGuard.request({ label, action });
    return false;
  }
  action();
  return true;
}

export default function UnsavedChangesPrompt({ dirty, onSave, onDiscard }) {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(onSave);
  const discardRef = useRef(onDiscard);

  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => { discardRef.current = onDiscard; }, [onDiscard]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const guard = {
      dirty,
      request(next) {
        if (!dirty) {
          next.action?.();
          return;
        }
        setPending(next);
      },
    };
    window.__arkUnsavedGuard = guard;
    return () => {
      if (window.__arkUnsavedGuard === guard) delete window.__arkUnsavedGuard;
    };
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const captureLink = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.href;
      if (!href || href === window.location.href) return;
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({
        label: destinationLabel(href),
        action: () => router.push(`${url.pathname}${url.search}${url.hash}`),
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", captureLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", captureLink, true);
    };
  }, [dirty, router]);

  async function saveAndContinue() {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveRef.current?.();
      if (saved !== false) {
        const action = pending?.action;
        setPending(null);
        action?.();
      }
    } finally {
      setSaving(false);
    }
  }

  function discardAndContinue() {
    discardRef.current?.();
    const action = pending?.action;
    setPending(null);
    action?.();
  }

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-950 shadow-2xl sm:p-7">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Unsaved changes</p>
        <h2 id="unsaved-title" className="mt-2 text-2xl font-black tracking-tight">You have unsaved changes</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Save what you changed, or continue to {pending.label || "the next page"} without saving.</p>
        <div className="mt-6 grid gap-2">
          <button type="button" disabled={saving} onClick={saveAndContinue} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
          <button type="button" disabled={saving} onClick={discardAndContinue} className="rounded-xl border border-red-300 px-5 py-3 text-sm font-black text-red-700 disabled:opacity-50">Continue to {pending.label || "Next Page"} Without Saving</button>
          <button type="button" disabled={saving} onClick={() => setPending(null)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 disabled:opacity-50">Stay Here</button>
        </div>
      </div>
    </div>
  );
}
