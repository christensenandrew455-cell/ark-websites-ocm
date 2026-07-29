"use client";

export default function ConfirmDialog({ open, message, confirmLabel = "Yes", cancelLabel = "Cancel", busy = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirmation">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
        <p className="text-base font-black text-slate-950">{message}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">{cancelLabel}</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-red-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? "Deleting…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
