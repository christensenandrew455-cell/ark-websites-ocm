"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";

function percent(value) {
  return `${Math.min(50, Math.max(0, Number(value || 0)))}%`;
}

export default function ReferralCenter({ clientId = "" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !user) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    user.getIdToken(true)
      .then((token) => fetch("/api/referrals/status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || "Could not load referral progress.");
        if (active) setStatus(data);
      })
      .catch((loadError) => active && setError(ownerFacingError(loadError)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, user]);

  const accountId = status?.referralCode || status?.accountId || status?.clientId || clientId;
  const qualified = Math.min(5, Math.max(0, Number(status?.qualifiedCount ?? status?.referralCount ?? 0)));
  const discount = Number(status?.discountPercent ?? status?.referralDiscountPercent ?? qualified * 10);

  async function copyAccountId() {
    if (!accountId) return;
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy did not work. Press and hold the account ID to copy it.");
    }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="ark-referral-button fixed z-[70] flex items-center gap-2 rounded-2xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 px-3 py-3 text-left text-slate-950 shadow-xl ring-1 ring-amber-600/30 transition hover:scale-[1.02] active:scale-[0.98]" aria-label="Open referral savings">
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-white/75 text-xl shadow-sm">★</span>
      <span className="pr-1 leading-tight"><span className="block text-[9px] font-black uppercase tracking-[0.14em]">Refer & save</span><span className="block text-sm font-black">Up to 50% off</span></span>
    </button>
    {open && <div className="ark-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="referral-title">
      <button type="button" className="absolute inset-0" onClick={() => setOpen(false)} aria-label="Close referral savings" />
      <section className="ark-modal-surface ark-modal-scroll max-w-lg p-6 sm:p-8">
        <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-lg font-black text-slate-700" aria-label="Close">×</button>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Referral savings</p>
        <h2 id="referral-title" className="mt-2 pr-10 text-3xl font-black tracking-tight text-slate-950">Save up to 50%</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Give another business your account ID. When its paid account activates, you receive 10% off every usage charge for 30 days, up to 50% off.</p>
        {loading ? <p className="mt-6 rounded-2xl bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">Loading referral progress…</p> : <>
          <div className="mt-6 rounded-2xl bg-gradient-to-br from-slate-950 to-indigo-950 p-5 text-white">
            <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Active usage savings</p><p className="mt-1 text-4xl font-black">{percent(discount)} off</p></div><p className="text-sm font-black">{qualified} of 5</p></div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-amber-400" style={{ width: `${qualified * 20}%` }} /></div>
          </div>
          <div className="mt-4"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Your account ID</p><button type="button" onClick={copyAccountId} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-left"><span className="min-w-0 break-all text-sm font-black text-slate-950">{accountId || "Not available"}</span><span className="shrink-0 text-xs font-black text-indigo-700">{copied ? "Copied" : "Copy"}</span></button></div>
        </>}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
      </section>
    </div>}
  </>;
}
