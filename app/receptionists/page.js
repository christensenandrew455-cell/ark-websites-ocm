"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const PACING = [
  { value: 0.85, label: "Slow" },
  { value: 1, label: "Normal" },
  { value: 1.15, label: "Fast" },
];
const PAUSES = [
  { value: 700, label: "Quick response" },
  { value: 900, label: "Natural" },
  { value: 1200, label: "Patient" },
];

function Field({ label, hint, children, wide = false }) {
  return (
    <label className={wide ? "block md:col-span-2" : "block"}>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange, placeholder = "", type = "text", readOnly = false }) {
  return <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={readOnly ? "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" : "mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"} />;
}

function Textarea({ value, onChange, placeholder = "", rows = 5 }) {
  return <textarea value={value ?? ""} onChange={onChange} placeholder={placeholder} rows={rows} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-950" />;
}

function Select({ value, onChange, children }) {
  return <select value={value ?? ""} onChange={onChange} className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950">{children}</select>;
}

function Status({ profile }) {
  if (!profile.connectionKey) return <span className="rounded-full border border-slate-300 px-2.5 py-1 text-[9px] font-black uppercase text-slate-600">Needs Key</span>;
  if (!profile.receptionistPhone || !profile.telnyxConnectionId) return <span className="rounded-full border border-slate-300 px-2.5 py-1 text-[9px] font-black uppercase text-slate-600">Needs Setup</span>;
  if (!profile.enabled) return <span className="rounded-full border border-slate-300 px-2.5 py-1 text-[9px] font-black uppercase text-slate-600">Off</span>;
  return <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[9px] font-black uppercase text-white">Ready</span>;
}

export default function ReceptionistsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => profiles.find((profile) => profile.clientId === selectedId) || null, [profiles, selectedId]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return profiles;
    return profiles.filter((profile) => [profile.businessName, profile.ownerName, profile.accountEmail, profile.clientId, profile.receptionistPhone]
      .some((value) => String(value || "").toLowerCase().includes(normalized)));
  }, [profiles, query]);

  async function adminFetch(url, options = {}) {
    const token = await user.getIdToken(true);
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The administrator request failed.");
    return data;
  }

  async function loadProfiles(preferredId = "") {
    const data = await adminFetch("/api/admin/receptionists");
    const next = data.profiles || [];
    setProfiles(next);
    const nextId = preferredId && next.some((profile) => profile.clientId === preferredId) ? preferredId : "";
    setSelectedId(nextId);
  }

  useEffect(() => {
    if (loading || !user || !isAdmin) {
      if (!loading) setLoadingProfiles(false);
      return;
    }
    loadProfiles().catch((loadError) => setError(loadError.message)).finally(() => setLoadingProfiles(false));
  }, [isAdmin, loading, user]);

  useEffect(() => {
    setForm(selected ? { ...selected } : null);
    setMessage("");
    setError("");
  }, [selected]);

  function update(field, value) {
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const data = await adminFetch("/api/admin/receptionists", { method: "POST", body: JSON.stringify(form) });
      setProfiles((current) => current.map((profile) => profile.clientId === data.profile.clientId ? data.profile : profile));
      setForm(data.profile);
      setMessage("Receptionist profile saved. The shared Railway service will load this configuration for the next call.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile() {
    if (!form || !window.confirm(`Delete only the AI receptionist configuration for ${form.businessName}? The client account will remain.`)) return;
    setBusy(true);
    setError("");
    try {
      await adminFetch("/api/admin/receptionists", { method: "DELETE", body: JSON.stringify({ clientId: form.clientId }) });
      await loadProfiles();
      setMessage("Receptionist configuration deleted. The client account was not deleted.");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || loadingProfiles) return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Loading receptionist profiles…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Administrator access required</h1></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Administrator</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">AI Receptionists</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">One Railway deployment, one shared webhook, and one editable profile for every business. Incoming calls are matched by Telnyx phone number and connection ID.</p>
          </div>
          <button type="button" onClick={() => loadProfiles(selectedId).catch((refreshError) => setError(refreshError.message))} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {message && <div className="mb-4 rounded-xl border border-slate-300 bg-white p-3 text-sm font-bold text-slate-800">{message}</div>}

        {!selectedId && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Client Profiles</h2><p className="mt-1 text-xs font-semibold text-slate-500">Open a client to configure or edit their receptionist.</p></div><span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">{profiles.length}</span></div>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search business, owner, email, client ID, or phone" className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-950" />
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((profile) => (
                <button key={profile.clientId} type="button" onClick={() => setSelectedId(profile.clientId)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400">
                  <div className="min-w-0"><p className="truncate text-sm font-black">{profile.businessName}</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{profile.ownerName || profile.accountEmail}</p><p className="mt-1 truncate font-mono text-[9px] text-slate-400">{profile.clientId}</p></div>
                  <Status profile={profile} />
                </button>
              ))}
            </div>
            {visible.length === 0 && <p className="mt-4 rounded-xl border border-slate-200 p-6 text-center text-sm font-semibold text-slate-500">No client profiles match that search.</p>}
          </section>
        )}

        {form && (
          <form onSubmit={save} className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-black sm:text-3xl">{form.businessName}</h2><Status profile={form} /></div><p className="mt-1 font-mono text-[10px] text-slate-500">{form.clientId}</p></div>
                <button type="button" onClick={() => setSelectedId("")} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button>
              </div>
              <label className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black">Receptionist enabled<input type="checkbox" checked={form.enabled !== false} onChange={(event) => update("enabled", event.target.checked)} /></label>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Telnyx phone number" hint="The phone number the caller dials."><Input value={form.receptionistPhone} onChange={(event) => update("receptionistPhone", event.target.value)} placeholder="+1 978 555 0100" /></Field>
                <Field label="Telnyx connection ID" hint="Used with the destination number to verify the correct Voice API application."><Input value={form.telnyxConnectionId} onChange={(event) => update("telnyxConnectionId", event.target.value)} placeholder="Telnyx connection ID" /></Field>
                <Field label="Client ID"><Input value={form.clientId} readOnly /></Field>
                <Field label="Client connection key" hint="Generated on the Connections page and used server-to-server."><Input value={form.connectionKey || "Generate a connection key first"} readOnly /></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <h2 className="text-xl font-black">Voice and Script</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Receptionist name"><Input value={form.receptionistName} onChange={(event) => update("receptionistName", event.target.value)} /></Field>
                <Field label="Realtime model"><Input value={form.aiModel} onChange={(event) => update("aiModel", event.target.value)} placeholder="gpt-realtime" /></Field>
                <Field label="Voice"><Select value={form.aiVoice} onChange={(event) => update("aiVoice", event.target.value)}>{VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</Select></Field>
                <Field label="Pacing"><Select value={Number(form.aiSpeechSpeed)} onChange={(event) => update("aiSpeechSpeed", Number(event.target.value))}>{PACING.map((pace) => <option key={pace.value} value={pace.value}>{pace.label}</option>)}</Select></Field>
                <Field label="Pause detection"><Select value={Number(form.aiSilenceMs)} onChange={(event) => update("aiSilenceMs", Number(event.target.value))}>{PAUSES.map((pause) => <option key={pause.value} value={pause.value}>{pause.label}</option>)}</Select></Field>
                <Field label="Opening line"><Input value={form.openingLine} onChange={(event) => update("openingLine", event.target.value)} /></Field>
                <Field label="Closing line" wide><Input value={form.closingLine} onChange={(event) => update("closingLine", event.target.value)} /></Field>
                <Field label="Receptionist script" hint="Write the call flow line by line. The shared backend loads this exact profile when this number receives a call." wide><Textarea rows={14} value={form.receptionistScript} onChange={(event) => update("receptionistScript", event.target.value)} /></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <h2 className="text-xl font-black">Business Information</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Business name"><Input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} /></Field>
                <Field label="Owner name"><Input value={form.ownerName} onChange={(event) => update("ownerName", event.target.value)} /></Field>
                <Field label="Business phone"><Input value={form.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} /></Field>
                <Field label="Business email"><Input type="email" value={form.businessEmail} onChange={(event) => update("businessEmail", event.target.value)} /></Field>
                <Field label="Business hours"><Input value={form.businessHours} onChange={(event) => update("businessHours", event.target.value)} /></Field>
                <Field label="Time zone"><Input value={form.timeZone} onChange={(event) => update("timeZone", event.target.value)} placeholder="America/New_York" /></Field>
                <Field label="Estimate days"><Input value={form.estimateDays} onChange={(event) => update("estimateDays", event.target.value)} /></Field>
                <Field label="Estimate weekdays" hint="One weekday per line."><Textarea value={form.estimateWeekdays} onChange={(event) => update("estimateWeekdays", event.target.value)} /></Field>
                <Field label="Earliest estimate time"><Input value={form.earliestEstimateStart} onChange={(event) => update("earliestEstimateStart", event.target.value)} /></Field>
                <Field label="Latest estimate time"><Input value={form.latestEstimateStart} onChange={(event) => update("latestEstimateStart", event.target.value)} /></Field>
                <Field label="Business base"><Input value={form.businessBase} onChange={(event) => update("businessBase", event.target.value)} placeholder="City or region" /></Field>
                <Field label="Service areas" hint="One area per line."><Textarea value={form.serviceAreas} onChange={(event) => update("serviceAreas", event.target.value)} /></Field>
                <Field label="Services" hint="One per line: Service | Description" wide><Textarea rows={7} value={form.services} onChange={(event) => update("services", event.target.value)} placeholder="Interior painting | Walls, ceilings, trim, and cabinets." /></Field>
                <Field label="About the business" hint="One fact per line." wide><Textarea value={form.about} onChange={(event) => update("about", event.target.value)} /></Field>
                <Field label="Extra business information" hint="Policies, common questions, limitations, and anything else the receptionist may say." wide><Textarea rows={8} value={form.businessInfo} onChange={(event) => update("businessInfo", event.target.value)} /></Field>
              </div>
            </section>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-600">Saving updates the central profile. You do not redeploy Railway for normal client edits.</p>
              <button type="button" disabled={busy} onClick={removeProfile} className="rounded-xl border border-red-300 bg-white px-5 py-3 text-xs font-black text-red-700 disabled:opacity-50">Delete Configuration</button>
              <button type="submit" disabled={busy || !form.connectionKey} className="rounded-xl bg-slate-950 px-6 py-3 text-xs font-black text-white disabled:opacity-50">{busy ? "Saving…" : "Save Receptionist"}</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
