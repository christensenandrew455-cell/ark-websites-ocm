"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

function destinationLabel(href) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.pathname === "/") return "Dashboard";
    if (url.pathname === "/settings") return "Settings";
    if (url.pathname === "/employee/settings") return "Employee Settings";
    if (url.pathname === "/employee/leads") return "Leads";
    if (url.pathname === "/lead-messages") return "Messages";
    return "the previous page";
  } catch {
    return "the previous page";
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
  const pathname = usePathname();
  const router = useRouter();
  const autoSave = pathname === "/settings" || pathname.startsWith("/settings/");
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const saveRef = useRef(onSave);
  const discardRef = useRef(onDiscard);

  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => { discardRef.current = onDiscard; }, [onDiscard]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const guard = {
      dirty,
      async request(next) {
        if (!guard.dirty) {
          next.action?.();
          return;
        }
        if (!autoSave) {
          setPending(next);
          return;
        }
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
          const saved = await saveRef.current?.();
          if (saved !== false) {
            guard.dirty = false;
            next.action?.();
          }
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      },
    };
    window.__arkUnsavedGuard = guard;
    return () => {
      if (window.__arkUnsavedGuard === guard) delete window.__arkUnsavedGuard;
    };
  }, [autoSave, dirty]);

  useEffect(() => {
    if (!dirty || autoSave) return undefined;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [autoSave, dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
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
      window.__arkUnsavedGuard?.request({
        label: destinationLabel(href),
        action: () => router.push(`${url.pathname}${url.search}${url.hash}`),
      });
    };
    document.addEventListener("click", captureLink, true);
    return () => document.removeEventListener("click", captureLink, true);
  }, [dirty, router]);

  useEffect(() => {
    const navigation = typeof window !== "undefined" ? window.navigation : null;
    if (!dirty || !navigation?.addEventListener) return undefined;
    const captureTraversal = (event) => {
      if (event.navigationType !== "traverse" || event.canIntercept !== true || event.cancelable !== true) return;
      try { event.preventDefault(); } catch { return; }
      const destination = event.destination;
      window.__arkUnsavedGuard?.request({
        label: destinationLabel(destination?.url || ""),
        action: () => {
          try {
            if (destination?.key) navigation.traverseTo(destination.key);
            else if (destination?.url) router.push(new URL(destination.url).pathname);
          } catch {
            if (destination?.url) router.push(new URL(destination.url).pathname);
          }
        },
      });
    };
    navigation.addEventListener("navigate", captureTraversal);
    return () => navigation.removeEventListener("navigate", captureTraversal);
  }, [dirty, router]);

  function releaseGuard() {
    if (typeof window !== "undefined" && window.__arkUnsavedGuard) window.__arkUnsavedGuard.dirty = false;
  }

  async function saveAndContinue() {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveRef.current?.();
      if (saved !== false) {
        releaseGuard();
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
    releaseGuard();
    const action = pending?.action;
    setPending(null);
    action?.();
  }

  if (!pending || autoSave) return null;

  return (
    <div className="ark-modal-overlay z-[200]" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <div className="ark-modal-surface max-w-md p-6 text-slate-950 sm:p-7">
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
