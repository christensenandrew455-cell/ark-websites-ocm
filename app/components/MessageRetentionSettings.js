"use client";

import { useCallback, useEffect, useState } from "react";
import AppSelect from "./AppSelect";
import { useAuth } from "./AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";
import InfoTip from "./InfoTip";

const OPTIONS = [
  { value: 0, label: "Never delete" },
  { value: 1, label: "Delete after 1 day" },
  { value: 7, label: "Delete after 1 week" },
  { value: 30, label: "Delete after 1 month" },
];

const FIELD_LABEL_CLASS = "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs";

function RetentionSelect({ title, endpoint }) {
  const { user } = useAuth();
  const [retentionDays, setRetentionDays] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setRetentionDays(Number(data.retentionDays || 0));
    } catch {}
  }, [endpoint, user]);

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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ retentionDays: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not update ${title.toLowerCase()}.`);
      setRetentionDays(Number(data.retentionDays || 0));
    } catch (saveError) {
      setRetentionDays(previous);
      setError(ownerFacingError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return <div className="block rounded-xl border border-slate-200 p-4">
    <span className="flex items-center justify-between gap-3"><span className={FIELD_LABEL_CLASS}>{title}</span>{saving && <span className="text-xs font-bold text-slate-400">Saving…</span>}</span>
    <AppSelect className="mt-3" label={`${title} auto-delete`} value={retentionDays} disabled={saving} onChange={updateRetention} options={OPTIONS} />
    {error && <span className="mt-2 block text-xs font-bold text-red-700">{error}</span>}
  </div>;
}

export default function MessageRetentionSettings({ showMessages = false, embedded = false }) {
  return (
    <section className={embedded ? "mt-6 border-t border-slate-200 pt-6" : "rounded-2xl border border-slate-200 p-4 sm:p-5"}>
      <span className="flex items-center gap-2"><h3 className="text-base font-black text-slate-950">Auto-delete</h3><InfoTip label="About auto-delete">Deletes old records after the time you choose. “Never delete” keeps them until you remove them.</InfoTip></span>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <RetentionSelect title="Leads" endpoint="/api/business/leads/retention" />
        <RetentionSelect title="Clients" endpoint="/api/business/clients/retention" />
        {showMessages && <RetentionSelect title="Messages" endpoint="/api/business/lead-messages/retention" />}
      </div>
    </section>
  );
}
