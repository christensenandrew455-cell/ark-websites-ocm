"use client";

import { useEffect, useState } from "react";
import { confirmationEventName } from "../lib/appConfirmation";

export default function GlobalConfirmDialog() {
  const [request, setRequest] = useState(null);
  const [typedValue, setTypedValue] = useState("");

  useEffect(() => {
    const open = (event) => {
      setTypedValue("");
      setRequest(event.detail || null);
    };
    window.addEventListener(confirmationEventName(), open);
    return () => window.removeEventListener(confirmationEventName(), open);
  }, []);

  if (!request) return null;

  const requiredText = String(request.requiredText || "");
  const confirmedText = !requiredText || typedValue.trim() === requiredText;

  function finish(confirmed) {
    const resolve = request.resolve;
    setRequest(null);
    setTypedValue("");
    resolve?.(confirmed);
  }

  return (
    <div className="ark-modal-overlay z-[240]" role="dialog" aria-modal="true" aria-labelledby="global-confirm-title">
      <div className="ark-modal-surface max-w-md p-5 sm:p-6">
        <h2 id="global-confirm-title" className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{request.title || "Are you sure?"}</h2>
        {request.message && <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{request.message}</p>}
        {requiredText && (
          <label className="mt-5 block">
            <span className="text-xs font-black text-slate-700">Type {requiredText} to confirm</span>
            <input autoFocus value={typedValue} onChange={(event) => setTypedValue(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-950" />
          </label>
        )}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => finish(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800">{request.cancelLabel || "Cancel"}</button>
          <button type="button" disabled={!confirmedText} onClick={() => finish(true)} className="rounded-xl bg-red-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{request.confirmLabel || "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}
