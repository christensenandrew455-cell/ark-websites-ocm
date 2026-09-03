"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";

export default function ClientDeclineNoticeSettings() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    user.getIdToken(true)
      .then((token) => fetch("/api/account/client-decline-notice", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) throw new Error(data.error || "Could not load the lead status notice setting.");
        setEnabled(data.enabled !== false);
        setError("");
      })
      .catch((loadError) => active && setError(ownerFacingError(loadError)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [user]);

  async function update(checked) {
    if (!user || saving) return;
    const previous = enabled;
    setEnabled(checked);
    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/client-decline-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: checked }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update the lead status notice setting.");
      setEnabled(data.enabled !== false);
    } catch (saveError) {
      setEnabled(previous);
      setError(ownerFacingError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-base font-black text-slate-950">Customer updates</h3>
      <label htmlFor="customer-decision-texts" className={`mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 ${loading || saving ? "cursor-not-allowed bg-slate-50 opacity-60" : "cursor-pointer bg-white"}`}>
        <span className="min-w-0"><span className="block text-sm font-black text-slate-950">Text customers</span><span className="mt-1 block text-xs font-semibold text-slate-600">After you accept or decline.</span></span>
        <input id="customer-decision-texts" type="checkbox" disabled={loading || saving} checked={enabled} onChange={(event) => update(event.target.checked)} className="sr-only" />
        <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition ${enabled ? "bg-blue-800" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${enabled ? "left-6" : "left-1"}`} /></span>
      </label>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </section>
  );
}
