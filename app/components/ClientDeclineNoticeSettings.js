"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";
import InfoTip from "./InfoTip";

const LABEL_CLASS = "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs";

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
    <div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2"><label htmlFor="customer-decision-texts" className={LABEL_CLASS}>Customer decision texts</label><InfoTip label="About customer decision texts">Text customers when you accept or decline their request.</InfoTip></div>
        <input
          id="customer-decision-texts"
          type="checkbox"
          disabled={loading || saving}
          checked={enabled}
          onChange={(event) => update(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-slate-950"
        />
      </div>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </div>
  );
}
