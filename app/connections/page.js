"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const SPEEDS = [
  { value: 0.85, label: "Slow" },
  { value: 0.94, label: "Normal" },
  { value: 1.08, label: "Fast" },
];
const SILENCE = [
  { value: 700, label: "Quick response" },
  { value: 1200, label: "Natural" },
  { value: 1800, label: "Patient" },
];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const TIME_OPTIONS = Array.from({ length: 25 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const labelHour = hour % 12 || 12;
  return `${labelHour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
});

const EMPTY_ACCOUNT = {
  clientId: "",
  businessName: "",
  ownerName: "",
  accountEmail: "",
  phone: "",
  sourceLabel: "",
  enabled: true,
  status: "active",
  receptionistConfigured: false,
  receptionistEnabled: true,
  receptionistPhone: "",
  billing: { phase: "current", restricted: false, showNotice: false, offenseNumber: 0 },
};

const EMPTY_CUSTOMER = {
  businessName: "",
  clientId: "",
  ownerName: "",
  accountEmail: "",
  temporaryPassword: "",
  phone: "",
  accountName: "",
};

function slug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatMoney(amount = 0, currency = "usd") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(Number(amount || 0) / 100);
  } catch {
    return `$${(Number(amount || 0) / 100).toFixed(2)}`;
  }
}

function Field({ label, hint = "", children, wide = false }) {
  return (
    <label className={wide ? "block md:col-span-2" : "block"}>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange, type = "text", placeholder = "", readOnly = false }) {
  return <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={readOnly ? "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" : "mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"} />;
}

function Textarea({ value, onChange, rows = 5, placeholder = "" }) {
  return <textarea value={value ?? ""} onChange={onChange} rows={rows} placeholder={placeholder} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-950" />;
}

function Select({ value, onChange, children }) {
  return <select value={value ?? ""} onChange={onChange} className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950">{children}</select>;
}

function CountBadge({ value }) {
  return <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">{value}</span>;
}

function Pill({ children }) {
  return <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[9px] font-black uppercase text-slate-700">{children}</span>;
}

function ReceptionistPill({ account }) {
  if (account.status === "disabled") return <Pill>Disabled</Pill>;
  if (!account.receptionistConfigured) return <Pill>Needs AI Setup</Pill>;
  if (!account.receptionistEnabled) return <Pill>AI Off</Pill>;
  return <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[9px] font-black uppercase text-white">AI Ready</span>;
}

function RequestStatus({ status }) {
  return <Pill>{String(status || "new").replaceAll("-", " ")}</Pill>;
}

function LegalAgreementPanel({ account }) {
  const accepted = account.termsAccepted && account.privacyAccepted && account.legalAcceptedAt;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Account evidence</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Legal Agreement</h2></div>
        <Pill>{accepted ? "Accepted" : "Not Recorded"}</Pill>
      </div>
      {accepted ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-500">Terms</p><Link href="/terms" target="_blank" className="mt-1 inline-block text-sm font-black underline">Version {account.termsVersion || "not labeled"}</Link></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-500">Privacy</p><Link href="/privacy" target="_blank" className="mt-1 inline-block text-sm font-black underline">Version {account.privacyVersion || "not labeled"}</Link></div>
          <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Accepted by</p><p className="mt-1 break-all text-sm font-bold">{account.legalAcceptedBy || account.accountEmail}</p></div>
          <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Accepted on</p><p className="mt-1 text-sm font-bold">{formatDate(account.legalAcceptedAt)}</p></div>
        </div>
      ) : <p className="mt-4 rounded-xl border border-slate-200 p-3 text-xs font-semibold text-slate-700">No signup agreement record is stored for this account.</p>}
    </section>
  );
}

function AccountCard({ business, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(business.clientId)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-400">
      <div className="min-w-0">
        <span className="block truncate text-sm font-black">{business.businessName}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{business.ownerName || business.accountEmail}</span>
        <span className="mt-1 block truncate text-[10px] text-slate-400">{business.receptionistPhone || business.phone || business.clientId}</span>
      </div>
      <ReceptionistPill account={business} />
    </button>
  );
}

function AccountSection({ title, description, businesses, onOpen, empty, searchQuery = "", onSearchChange = null }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">{title}</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p></div><CountBadge value={businesses.length} /></div>
      {onSearchChange && <input type="search" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search business, name, email, phone, or client ID" className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-950" />}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{businesses.map((business) => <AccountCard key={business.clientId} business={business} onOpen={onOpen} />)}</div>
      {businesses.length === 0 && <p className="mt-4 rounded-xl border border-slate-200 p-5 text-center text-sm font-semibold text-slate-500">{empty}</p>}
    </section>
  );
}

function profileForEditing(profile) {
  return {
    ...profile,
    serviceAreasText: Array.isArray(profile.serviceAreas) ? profile.serviceAreas.join("\n") : "",
    servicesText: profile.services && typeof profile.services === "object" ? Object.entries(profile.services).map(([name, description]) => `${name} | ${description}`).join("\n") : "",
    aboutText: Array.isArray(profile.about) ? profile.about.join("\n") : "",
  };
}

export default function ConnectionsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState(EMPTY_ACCOUNT);
  const [receptionist, setReceptionist] = useState(null);
  const [showReceptionist, setShowReceptionist] = useState(false);
  const [requestHistory, setRequestHistory] = useState([]);
  const [newCustomer, setNewCustomer] = useState(EMPTY_CUSTOMER);
  const [showCreate, setShowCreate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => businesses.find((business) => business.clientId === selectedId) || null, [businesses, selectedId]);
  const needsSetup = useMemo(() => businesses.filter((business) => business.status !== "disabled" && !business.receptionistConfigured), [businesses]);
  const activeAccounts = useMemo(() => businesses.filter((business) => business.status !== "disabled" && business.receptionistConfigured), [businesses]);
  const visibleActive = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeAccounts;
    return activeAccounts.filter((business) => [business.businessName, business.ownerName, business.accountEmail, business.phone, business.receptionistPhone, business.clientId].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [activeAccounts, searchQuery]);
  const disabledAccounts = useMemo(() => businesses.filter((business) => business.status === "disabled"), [businesses]);

  async function adminFetch(url, options = {}) {
    const token = await user.getIdToken(true);
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The administrator request failed.");
    return data;
  }

  async function loadBusinesses(preferredId = "") {
    const data = await adminFetch("/api/admin/connections");
    const next = data.businesses || [];
    setBusinesses(next);
    const requested = preferredId || new URLSearchParams(window.location.search).get("clientId") || "";
    setSelectedId(requested && next.some((business) => business.clientId === requested) ? requested : "");
  }

  useEffect(() => {
    if (loading || !user || !isAdmin) {
      if (!loading) setIsLoading(false);
      return;
    }
    loadBusinesses().catch((loadError) => setError(loadError.message)).finally(() => setIsLoading(false));
  }, [isAdmin, loading, user]);

  useEffect(() => {
    if (!selected) {
      setForm(EMPTY_ACCOUNT);
      setReceptionist(null);
      setShowReceptionist(false);
      setRequestHistory([]);
      return;
    }
    setForm({ ...EMPTY_ACCOUNT, ...selected });
    setMessage("");
    setError("");
    Promise.all([
      adminFetch(`/api/requests?clientId=${encodeURIComponent(selected.clientId)}&includeClosed=1`),
      adminFetch(`/api/receptionist/settings?clientId=${encodeURIComponent(selected.clientId)}`),
    ]).then(([history, profile]) => {
      setRequestHistory(history.requests || []);
      setReceptionist(profileForEditing(profile.profile));
      setShowReceptionist(profile.profile.configured === true);
    }).catch((loadError) => setError(loadError.message));
  }, [selected]);

  function updateField(field, value) {
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateReceptionist(field, value) {
    setMessage("");
    setReceptionist((current) => ({ ...current, [field]: value }));
  }

  function toggleWeekday(day) {
    setReceptionist((current) => {
      const days = new Set(current.estimateWeekdays || []);
      if (days.has(day)) days.delete(day); else days.add(day);
      return { ...current, estimateWeekdays: WEEKDAYS.filter((item) => days.has(item)) };
    });
  }

  function updateNewCustomer(field, value) {
    setNewCustomer((current) => {
      const next = { ...current, [field]: value };
      if (field === "businessName" && (!current.clientId || current.clientId === slug(current.businessName))) next.clientId = slug(value);
      if (field === "businessName" && !current.accountName) next.accountName = value;
      return next;
    });
  }

  async function createCustomer(event) {
    event.preventDefault();
    setIsCreating(true);
    setError("");
    try {
      const result = await adminFetch("/api/admin/businesses", {
        method: "POST",
        body: JSON.stringify({
          businessName: newCustomer.businessName,
          clientId: newCustomer.clientId,
          ownerName: newCustomer.ownerName,
          accountEmail: newCustomer.accountEmail,
          temporaryPassword: newCustomer.temporaryPassword,
          businessPhone: newCustomer.phone,
          notificationPhone: newCustomer.phone,
          notificationEmail: newCustomer.accountEmail,
          sourceLabel: newCustomer.accountName || newCustomer.businessName,
        }),
      });
      await loadBusinesses(result.clientId);
      setNewCustomer(EMPTY_CUSTOMER);
      setShowCreate(false);
      setMessage(`${result.businessName} was created. The customer can now complete their business information in Settings.`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setIsCreating(false);
    }
  }

  async function saveProfile() {
    if (!selectedId) return;
    setIsSaving(true);
    setError("");
    try {
      const accountResult = await adminFetch("/api/admin/connections", {
        method: "POST",
        body: JSON.stringify({ ...form, clientId: selectedId }),
      });
      let receptionistResult = null;
      if (showReceptionist || receptionist?.configured) {
        receptionistResult = await adminFetch("/api/receptionist/settings", {
          method: "POST",
          body: JSON.stringify({
            ...receptionist,
            clientId: selectedId,
            serviceAreas: receptionist.serviceAreasText,
            services: receptionist.servicesText,
            about: receptionist.aboutText,
          }),
        });
        setReceptionist(profileForEditing(receptionistResult.profile));
        setShowReceptionist(true);
      }
      const nextAccount = {
        ...accountResult.connection,
        receptionistConfigured: receptionistResult ? true : accountResult.connection.receptionistConfigured,
        receptionistEnabled: receptionistResult ? receptionistResult.profile.enabled : accountResult.connection.receptionistEnabled,
        receptionistPhone: receptionistResult ? receptionistResult.profile.receptionistPhone : accountResult.connection.receptionistPhone,
      };
      setBusinesses((current) => current.map((business) => business.clientId === selectedId ? nextAccount : business));
      setForm(nextAccount);
      setMessage(receptionistResult ? "Account and AI receptionist settings saved." : "Account saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function lifecycleAction(action) {
    if (!selectedId || lifecycleBusy) return;
    if (action === "disable" && !window.confirm("Disable this customer now? Their login and AI receptionist will stop working.")) return;
    if (action === "restore" && !window.confirm("Restore this customer account?")) return;
    let confirmation = "";
    let confirmPermanent = false;
    if (action === "delete-now") {
      if (!window.confirm("Permanently delete this account and its active data?")) return;
      confirmation = window.prompt(`Type ${selectedId} to permanently delete this customer.`) || "";
      if (confirmation !== selectedId) return;
      confirmPermanent = true;
    }
    setLifecycleBusy(true);
    setError("");
    try {
      await adminFetch("/api/admin/customers/lifecycle", { method: "POST", body: JSON.stringify({ clientId: selectedId, action, confirmation, confirmPermanent }) });
      if (action === "delete-now") {
        await loadBusinesses();
        setMessage("Customer account permanently deleted.");
      } else {
        await loadBusinesses(selectedId);
        setMessage(action === "restore" ? "Customer account restored." : "Customer account disabled.");
      }
    } catch (lifecycleError) {
      setError(lifecycleError.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Loading accounts…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Administrator access required</h1></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-end justify-between gap-3 sm:mb-8">
          <div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Administrator</p><h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Accounts</h1></div>
          <div className="flex items-center gap-2"><button type="button" onClick={() => loadBusinesses(selectedId).catch((loadError) => setError(loadError.message))} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">Refresh</button><button type="button" onClick={() => { setShowCreate((current) => !current); setSelectedId(""); }} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">{showCreate ? "Close" : "Add Customer"}</button></div>
        </div>
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {message && <div className="mb-4 rounded-xl border border-slate-300 bg-white p-3 text-sm font-bold text-slate-800">{message}</div>}

        {showCreate && (
          <form onSubmit={createCustomer} className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
            <h2 className="text-xl font-black">New Customer</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Account name"><Input value={newCustomer.accountName} onChange={(event) => updateNewCustomer("accountName", event.target.value)} placeholder="Name shown inside ARK" /></Field>
              <Field label="Business name"><Input value={newCustomer.businessName} onChange={(event) => updateNewCustomer("businessName", event.target.value)} /></Field>
              <Field label="Name"><Input value={newCustomer.ownerName} onChange={(event) => updateNewCustomer("ownerName", event.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={newCustomer.accountEmail} onChange={(event) => updateNewCustomer("accountEmail", event.target.value)} /></Field>
              <Field label="Phone"><Input value={newCustomer.phone} onChange={(event) => updateNewCustomer("phone", event.target.value)} /></Field>
              <Field label="Temporary password"><Input type="password" value={newCustomer.temporaryPassword} onChange={(event) => updateNewCustomer("temporaryPassword", event.target.value)} /></Field>
              <Field label="Client ID" wide><Input value={newCustomer.clientId} onChange={(event) => updateNewCustomer("clientId", slug(event.target.value))} /></Field>
            </div>
            <button disabled={isCreating} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{isCreating ? "Creating…" : "Create Customer"}</button>
          </form>
        )}

        {!showCreate && !selectedId && <div className="space-y-4"><AccountSection title="Needs AI Setup" description="Accounts that still need an AI receptionist phone number and settings." businesses={needsSetup} onOpen={setSelectedId} empty="Every active account has AI receptionist settings." /><AccountSection title="AI Receptionist Accounts" description="Accounts with saved AI receptionist settings." businesses={visibleActive} onOpen={setSelectedId} empty={searchQuery ? "No accounts match that search." : "No AI receptionist accounts are configured yet."} searchQuery={searchQuery} onSearchChange={setSearchQuery} /><AccountSection title="Disabled Accounts" description="Accounts that are currently disabled." businesses={disabledAccounts} onOpen={setSelectedId} empty="No disabled accounts." /></div>}

        {selectedId && (
          <div className="space-y-4 sm:space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-black sm:text-3xl">{form.businessName}</h2><ReceptionistPill account={form} /></div><p className="mt-1 font-mono text-[10px] text-slate-500">{selectedId}</p></div><button type="button" onClick={() => setSelectedId("")} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button></div>
              <label className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black">Account enabled<input type="checkbox" disabled={form.status === "disabled"} checked={form.enabled && form.status !== "disabled"} onChange={(event) => updateField("enabled", event.target.checked)} /></label>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Name"><Input value={form.ownerName} onChange={(event) => updateField("ownerName", event.target.value)} /></Field>
                <Field label="Email"><Input value={form.accountEmail} readOnly /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} /></Field>
                <Field label="Account name"><Input value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} /></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">AI Receptionist Settings</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">The customer fills in business information from their Settings page. You can finish or edit everything here.</p></div><button type="button" onClick={() => setShowReceptionist((current) => !current)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">{showReceptionist ? "Hide" : form.receptionistConfigured ? "Edit" : "Add"}</button></div>

              {showReceptionist && receptionist && (
                <div className="mt-5 space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="AI receptionist phone number" hint="This called number selects the correct account and profile."><Input value={receptionist.receptionistPhone} onChange={(event) => updateReceptionist("receptionistPhone", event.target.value)} placeholder="+1 774 245 3383" /></Field>
                    <Field label="AI model"><Input value="GPT Realtime Mini" readOnly /></Field>
                    <Field label="AI voice"><Select value={receptionist.aiVoice} onChange={(event) => updateReceptionist("aiVoice", event.target.value)}>{VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</Select></Field>
                    <Field label="Speech speed"><Select value={Number(receptionist.aiSpeechSpeed)} onChange={(event) => updateReceptionist("aiSpeechSpeed", Number(event.target.value))}>{SPEEDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
                    <Field label="Pause detection"><Select value={Number(receptionist.aiSilenceMs)} onChange={(event) => updateReceptionist("aiSilenceMs", Number(event.target.value))}>{SILENCE.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black md:self-end">AI receptionist enabled<input type="checkbox" checked={receptionist.enabled !== false} onChange={(event) => updateReceptionist("enabled", event.target.checked)} /></label>
                  </div>

                  <div><h3 className="text-lg font-black">Business Information</h3><p className="mt-1 text-xs font-semibold text-slate-500">These fields fill the hard-coded receptionist script automatically.</p></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Business name"><Input value={receptionist.businessName} onChange={(event) => updateReceptionist("businessName", event.target.value)} /></Field>
                    <Field label="Receptionist name"><Input value={receptionist.receptionistName} onChange={(event) => updateReceptionist("receptionistName", event.target.value)} /></Field>
                    <Field label="Owner name"><Input value={receptionist.ownerName} onChange={(event) => updateReceptionist("ownerName", event.target.value)} /></Field>
                    <Field label="Business phone"><Input value={receptionist.businessPhone} onChange={(event) => updateReceptionist("businessPhone", event.target.value)} /></Field>
                    <Field label="Business email"><Input type="email" value={receptionist.businessEmail} onChange={(event) => updateReceptionist("businessEmail", event.target.value)} /></Field>
                    <Field label="Time zone"><Select value={receptionist.timeZone} onChange={(event) => updateReceptionist("timeZone", event.target.value)}>{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</Select></Field>
                    <Field label="Business hours" wide><Input value={receptionist.businessHours} onChange={(event) => updateReceptionist("businessHours", event.target.value)} /></Field>
                    <Field label="Estimate days summary"><Input value={receptionist.estimateDays} onChange={(event) => updateReceptionist("estimateDays", event.target.value)} placeholder="Monday through Friday" /></Field>
                    <Field label="Business base"><Input value={receptionist.businessBase} onChange={(event) => updateReceptionist("businessBase", event.target.value)} placeholder="Berlin, Massachusetts" /></Field>
                    <Field label="Earliest estimate time"><Select value={receptionist.earliestEstimateStart} onChange={(event) => updateReceptionist("earliestEstimateStart", event.target.value)}>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</Select></Field>
                    <Field label="Latest estimate time"><Select value={receptionist.latestEstimateStart} onChange={(event) => updateReceptionist("latestEstimateStart", event.target.value)}>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</Select></Field>
                    <div className="md:col-span-2"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">Estimate weekdays</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">{WEEKDAYS.map((day) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold capitalize"><input type="checkbox" checked={(receptionist.estimateWeekdays || []).includes(day)} onChange={() => toggleWeekday(day)} />{day}</label>)}</div></div>
                    <Field label="Service areas" hint="One area per line."><Textarea value={receptionist.serviceAreasText} onChange={(event) => updateReceptionist("serviceAreasText", event.target.value)} /></Field>
                    <Field label="About the business" hint="One fact per line."><Textarea value={receptionist.aboutText} onChange={(event) => updateReceptionist("aboutText", event.target.value)} /></Field>
                    <Field label="Services" hint="One per line: Service | Description" wide><Textarea rows={7} value={receptionist.servicesText} onChange={(event) => updateReceptionist("servicesText", event.target.value)} placeholder="Interior painting | Walls, ceilings, trim, doors, and rooms." /></Field>
                    <Field label="Opening line" wide><Input value={receptionist.openingLine} onChange={(event) => updateReceptionist("openingLine", event.target.value)} /></Field>
                    <Field label="Closing line" wide><Input value={receptionist.closingLine} onChange={(event) => updateReceptionist("closingLine", event.target.value)} /></Field>
                    <Field label="Extra business information" hint="Policies, common questions, limits, and facts the receptionist may use." wide><Textarea rows={8} value={receptionist.extraInformation} onChange={(event) => updateReceptionist("extraInformation", event.target.value)} /></Field>
                  </div>
                </div>
              )}
            </section>

            {form.billing?.showNotice && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-lg font-black">Payment Status</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-[10px] font-black uppercase text-slate-500">Phase</p><p className="font-black">{form.billing.phase.replaceAll("-", " ")}</p></div><div><p className="text-[10px] font-black uppercase text-slate-500">Amount due</p><p className="font-black">{formatMoney(form.billing.amountDue, form.billing.currency)}</p></div></div></section>}
            <LegalAgreementPanel account={form} />
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8"><div className="flex items-center justify-between"><h2 className="text-lg font-black">Request History</h2><CountBadge value={requestHistory.length} /></div><div className="mt-4 space-y-2">{requestHistory.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">{item.subject}</p><p className="mt-0.5 text-[10px] font-bold uppercase text-slate-400">{item.type} · {formatDate(item.createdAt)}</p></div><RequestStatus status={item.status} /></div><p className="mt-2 text-xs leading-5 text-slate-600">{item.message}</p></article>)}{requestHistory.length === 0 && <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">No requests for this account.</p>}</div></section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8"><h2 className="text-lg font-black">Account Control</h2><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction(form.status === "disabled" ? "restore" : "disable")} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-xs font-black disabled:opacity-50">{form.status === "disabled" ? "Restore" : "Disable"}</button><button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("delete-now")} className="rounded-xl bg-red-600 px-4 py-3 text-xs font-black text-white disabled:opacity-50">Delete Permanently</button><button type="button" disabled={isSaving || form.status === "disabled"} onClick={saveProfile} className="rounded-xl bg-slate-950 px-6 py-3 text-xs font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : "Save Profile"}</button></div></section>
          </div>
        )}
      </div>
    </main>
  );
}
