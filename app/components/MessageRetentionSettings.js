"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

const OPTIONS = [
  { value: 1, label: "Delete after 1 day" },
  { value: 7, label: "Delete after 1 week" },
  { value: 30, label: "Delete after 1 month" },
];

export default function MessageRetentionSettings() {
  const { user } = useAuth();
  const [retentionDays, setRetentionDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/lead-messages/retention", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setRetentionDays(Number(data.retentionDays || 30));
    } catch {}
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function updateRetention(value) {
    if (!user || saving) return;
    const previous = retentionDays;
    const next = Number(value);
    setRetentionDays(next);
    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/lead-messages/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ retentionDays: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update message auto-delete.");
      setRetentionDays(Number(data.retentionDays || 30));
    } catch (saveError) {
      setRetentionDays(previous);
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-7 border-t border-slate-200 pt-7">
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black">Message Auto-Delete</h3>{saving && <span className="text-xs font-bold text-slate-400">Saving…</span>}</div>
      <select value={retentionDays} disabled={saving} onChange={(event) => updateRetention(event.target.value)} className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-black outline-none focus:border-slate-950 disabled:opacity-50 sm:w-auto">
        {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </section>
  );
}
