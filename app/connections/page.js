"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const EMPTY_CONNECTION = {
  clientId: "",
  businessName: "",
  ownerName: "",
  accountEmail: "",
  status: "active",
  disabledAt: "",
  enabled: true,
  businessPhone: "",
  notificationPhone: "",
  notificationEmail: "",
  sourceLabel: "",
  connectionKey: "",
  termsAccepted: false,
  privacyAccepted: false,
  termsVersion: "",
  privacyVersion: "",
  legalAcceptedAt: "",
  legalAcceptedBy: "",
  legalAcceptanceSource: "",
  billing: { phase: "current", restricted: false, showNotice: false, offenseNumber: 0 },
};

const EMPTY_CUSTOMER = {
  businessName: "",
  clientId: "",
  ownerName: "",
  accountEmail: "",
  temporaryPassword: "",
  businessPhone: "",
  notificationEmail: "",
  notificationPhone: "",
  sourceLabel: "",
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

function Field({ label, children }) {
  return <label className="block"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{label}</span>{children}</label>;
}

function Input({ value, onChange, type = "text", placeholder = "", readOnly = false }) {
  return <input type={type} value={value || ""} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={readOnly ? "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" : "mt-1.5 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"} />;
}

function NeutralPill({ children }) {
  return <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[9px] font-black uppercase text-slate-700">{children}</span>;
}

function StatusPill({ account }) {
  if (account.billing?.phase === "deletion-review") return <NeutralPill>Deletion Review</NeutralPill>;
  if (account.billing?.restricted) return <NeutralPill>Payment Restricted</NeutralPill>;
  if (account.billing?.phase === "grace") return <NeutralPill>Payment Due</NeutralPill>;
  if (account.status === "approved_pending_payment") return <NeutralPill>Approved</NeutralPill>;
  if (account.status === "disabled") return <NeutralPill>Disabled</NeutralPill>;
  return <NeutralPill>Active</NeutralPill>;
}

function ConnectionPill({ account }) {
  if (account.status === "disabled") return <NeutralPill>Disabled</NeutralPill>;
  if (!account.connectionKey) return <NeutralPill>Needs Key</NeutralPill>;
  if (!account.enabled) return <NeutralPill>Connection Off</NeutralPill>;
  return <NeutralPill>Connected</NeutralPill>;
}

function RequestStatus({ status }) {
  return <NeutralPill>{String(status || "new").replaceAll("-", " ")}</NeutralPill>;
}

function LegalAgreementPanel({ account }) {
  const accepted = account.termsAccepted && account.privacyAccepted && account.legalAcceptedAt;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Account evidence</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Legal Agreement</h2></div><NeutralPill>{accepted ? "Accepted" : "Not Recorded"}</NeutralPill></div>
      {accepted ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-500">Terms</p><Link href="/terms" target="_blank" className="mt-1 inline-block text-sm font-black text-slate-950 underline">Version {account.termsVersion || "not labeled"}</Link></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-500">Privacy</p><Link href="/privacy" target="_blank" className="mt-1 inline-block text-sm font-black text-slate-950 underline">Version {account.privacyVersion || "not labeled"}</Link></div>
          <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Accepted by</p><p className="mt-1 break-all text-sm font-bold">{account.legalAcceptedBy || account.accountEmail}</p></div>
          <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Accepted on</p><p className="mt-1 text-sm font-bold">{formatDate(account.legalAcceptedAt)}</p></div>
        </div>
      ) : <p className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700">No signup agreement record is stored for this account.</p>}
    </section>
  );
}

function AccountCard({ business, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(business.clientId)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-400">
      <div className="min-w-0">
        <span className="block truncate text-sm font-black">{business.businessName}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{business.ownerName || business.accountEmail}</span>
        <span className="mt-1 block truncate font-mono text-[9px] text-slate-400">{business.clientId}</span>
      </div>
      <ConnectionPill account={business} />
    </button>
  );
}

function AccountSection({ title, description, businesses, onOpen, empty }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-xl font-black">{title}</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p></div>
        <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-black">{businesses.length}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {businesses.map((business) => <AccountCard key={business.clientId} business={business} onOpen={onOpen} />)}
      </div>
      {businesses.length === 0 && <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-center text-sm font-semibold text-slate-500">{empty}</p>}
    </section>
  );
}

export default function ConnectionsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState(EMPTY_CONNECTION);
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
  const visibleBusinesses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return businesses;
    return businesses.filter((business) => [business.businessName, business.ownerName, business.accountEmail, business.clientId]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [businesses, searchQuery]);
  const needsConnection = useMemo(() => visibleBusinesses.filter((business) => business.status !== "disabled" && (!business.connectionKey || business.enabled === false)), [visibleBusinesses]);
  const connectedAccounts = useMemo(() => visibleBusinesses.filter((business) => business.status !== "disabled" && Boolean(business.connectionKey) && business.enabled !== false), [visibleBusinesses]);
  const disabledAccounts = useMemo(() => visibleBusinesses.filter((business) => business.status === "disabled"), [visibleBusinesses]);

  async function adminFetch(url, options = {}) {
    const token = await user.getIdToken(true);
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The administrator request failed.");
    return data;
  }

  async function loadBusinesses(preferredId = "") {
    const data = await adminFetch("/api/admin/connections");
    const nextBusinesses = data.businesses || [];
    setBusinesses(nextBusinesses);
    const requested = preferredId || new URLSearchParams(window.location.search).get("clientId") || "";
    if (requested && nextBusinesses.some((business) => business.clientId === requested)) {
      setSelectedId(requested);
      setForm(nextBusinesses.find((business) => business.clientId === requested));
    } else {
      setSelectedId("");
      setForm(EMPTY_CONNECTION);
    }
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
      setForm(EMPTY_CONNECTION);
      setRequestHistory([]);
      return;
    }
    setForm({ ...EMPTY_CONNECTION, ...selected });
    setMessage("");
    setError("");
    adminFetch(`/api/requests?clientId=${encodeURIComponent(selected.clientId)}&includeClosed=1`)
      .then((data) => setRequestHistory(data.requests || []))
      .catch((historyError) => setError(historyError.message));
  }, [selected]);

  function openAccount(clientId) {
    setSelectedId(clientId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateField(field, value) {
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateNewCustomer(field, value) {
    setMessage("");
    setNewCustomer((current) => {
      const next = { ...current, [field]: value };
      if (field === "businessName" && (!current.clientId || current.clientId === slug(current.businessName))) next.clientId = slug(value);
      if (field === "businessName" && !current.sourceLabel) next.sourceLabel = `${value} receptionist`;
      if (field === "accountEmail" && !current.notificationEmail) next.notificationEmail = value;
      if (field === "businessPhone" && !current.notificationPhone) next.notificationPhone = value;
      return next;
    });
  }

  async function createCustomer(event) {
    event.preventDefault();
    setIsCreating(true);
    setError("");
    try {
      const result = await adminFetch("/api/admin/businesses", { method: "POST", body: JSON.stringify(newCustomer) });
      await loadBusinesses(result.clientId);
      setNewCustomer(EMPTY_CUSTOMER);
      setShowCreate(false);
      setMessage(`${result.businessName} was created. Share the temporary password securely.`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setIsCreating(false);
    }
  }

  async function saveConnection(event, regenerateKey = false) {
    event?.preventDefault();
    if (!selectedId) return;
    const hadKey = Boolean(form.connectionKey);
    setIsSaving(true);
    setError("");
    try {
      const data = await adminFetch("/api/admin/connections", { method: "POST", body: JSON.stringify({ ...form, clientId: selectedId, regenerateKey }) });
      setBusinesses((current) => current.map((business) => business.clientId === selectedId ? data.connection : business));
      setForm(data.connection);
      setMessage(regenerateKey ? hadKey ? "The connection key was regenerated." : "The connection key was generated." : "Customer setup saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function lifecycleAction(action) {
    if (!selectedId || lifecycleBusy) return;
    if (action === "disable" && !window.confirm("Disable this customer now? Their login and receptionist connection will stop working.")) return;
    if (action === "restore" && !window.confirm("Restore this customer account and receptionist connection?")) return;

    let confirmation = "";
    let confirmPermanent = false;
    if (action === "delete-now") {
      if (!window.confirm("Are you sure you want to permanently delete this account? Its active data cannot be recovered.")) return;
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

  async function copy(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Connection key copied.");
    } catch {
      setError("The browser could not copy that value.");
    }
  }

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Loading connections…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Administrator access required</h1></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-end justify-between gap-3 sm:mb-8"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Administrator</p><h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Connections</h1></div><button type="button" onClick={() => { setShowCreate((current) => !current); setSelectedId(""); }} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">{showCreate ? "Close" : "Add Customer"}</button></div>
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {message && <div className="mb-4 rounded-xl border border-slate-300 bg-white p-3 text-sm font-bold text-slate-800">{message}</div>}

        {showCreate && (
          <form onSubmit={createCustomer} className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
            <h2 className="text-xl font-black">New Customer</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Business name"><Input value={newCustomer.businessName} onChange={(event) => updateNewCustomer("businessName", event.target.value)} placeholder="Example Painting" /></Field>
              <Field label="Client ID"><Input value={newCustomer.clientId} onChange={(event) => updateNewCustomer("clientId", slug(event.target.value))} /></Field>
              <Field label="Owner name"><Input value={newCustomer.ownerName} onChange={(event) => updateNewCustomer("ownerName", event.target.value)} /></Field>
              <Field label="Customer email"><Input type="email" value={newCustomer.accountEmail} onChange={(event) => updateNewCustomer("accountEmail", event.target.value)} /></Field>
              <Field label="Temporary password"><Input type="password" value={newCustomer.temporaryPassword} onChange={(event) => updateNewCustomer("temporaryPassword", event.target.value)} /></Field>
              <Field label="Business phone"><Input value={newCustomer.businessPhone} onChange={(event) => updateNewCustomer("businessPhone", event.target.value)} /></Field>
              <Field label="Notification email"><Input type="email" value={newCustomer.notificationEmail} onChange={(event) => updateNewCustomer("notificationEmail", event.target.value)} /></Field>
              <Field label="Notification phone"><Input value={newCustomer.notificationPhone} onChange={(event) => updateNewCustomer("notificationPhone", event.target.value)} /></Field>
              <div className="col-span-2"><Field label="Source label"><Input value={newCustomer.sourceLabel} onChange={(event) => updateNewCustomer("sourceLabel", event.target.value)} /></Field></div>
            </div>
            <button disabled={isCreating} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{isCreating ? "Creating…" : "Create Customer"}</button>
          </form>
        )}

        {!showCreate && !selectedId && (
          <div className="space-y-4">
            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-5">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Search clients</span>
              <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Business, owner, email, or client ID" className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-950" />
            </label>
            <AccountSection title="Needs Connection" description="Approved customers that still need a key generated or their connection turned on." businesses={needsConnection} onOpen={openAccount} empty={searchQuery ? "No matching clients need a connection." : "Every approved customer has a connection key."} />
            <AccountSection title="Connected Accounts" description="Customers with an active receptionist connection and a saved private key." businesses={connectedAccounts} onOpen={openAccount} empty={searchQuery ? "No connected clients match that search." : "No customer connections are active yet."} />
            {disabledAccounts.length > 0 && <AccountSection title="Disabled Accounts" description="Accounts that are manually disabled and not currently connected." businesses={disabledAccounts} onOpen={openAccount} empty="No disabled accounts." />}
          </div>
        )}

        {selectedId && (
          <form onSubmit={saveConnection} className="space-y-3 sm:space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-black sm:text-3xl">{form.businessName}</h2><StatusPill account={form} /><ConnectionPill account={form} /></div><p className="mt-0.5 font-mono text-[10px] text-slate-500">{selectedId}</p></div><button type="button" onClick={() => setSelectedId("")} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Close</button></div>
              <label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black">OCM connection enabled<input type="checkbox" disabled={form.status === "disabled"} checked={form.enabled && form.status !== "disabled"} onChange={(event) => updateField("enabled", event.target.checked)} /></label>
              <div className="mt-4 grid grid-cols-2 gap-3"><Field label="Owner name"><Input value={form.ownerName} onChange={(event) => updateField("ownerName", event.target.value)} /></Field><Field label="Customer email"><Input value={form.accountEmail} readOnly /></Field><Field label="Business phone"><Input value={form.businessPhone} onChange={(event) => updateField("businessPhone", event.target.value)} /></Field><Field label="Notification email"><Input type="email" value={form.notificationEmail} onChange={(event) => updateField("notificationEmail", event.target.value)} /></Field><Field label="Notification phone"><Input value={form.notificationPhone} onChange={(event) => updateField("notificationPhone", event.target.value)} /></Field><Field label="Source label"><Input value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} /></Field></div>
            </section>

            {form.billing?.showNotice && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-lg font-black">Payment Status</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-[10px] font-black uppercase text-slate-500">Phase</p><p className="font-black">{form.billing.phase.replaceAll("-", " ")}</p></div><div><p className="text-[10px] font-black uppercase text-slate-500">Amount due</p><p className="font-black">{formatMoney(form.billing.amountDue, form.billing.currency)}</p></div><div><p className="text-[10px] font-black uppercase text-slate-500">Incident</p><p className="font-black">{form.billing.offenseNumber} in six months</p></div><div><p className="text-[10px] font-black uppercase text-slate-500">Review date</p><p className="font-black">{formatDate(form.billing.reviewAt)}</p></div></div></section>}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8"><h2 className="text-lg font-black">Private Connection Key</h2><p className="mt-1 text-xs font-semibold text-slate-500">Generate this key, then copy it into the customer’s AI receptionist connection.</p><div className="mt-4 flex gap-2"><input readOnly value={form.connectionKey || "No connection key saved"} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 font-mono text-[10px]" /><button type="button" disabled={!form.connectionKey} onClick={() => copy(form.connectionKey)} className="rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold disabled:opacity-40">Copy</button></div><button type="button" disabled={isSaving || form.status === "disabled"} onClick={() => saveConnection(null, true)} className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 disabled:opacity-50">{form.connectionKey ? "Regenerate Key" : "Generate Connection Key"}</button></section>

            <LegalAgreementPanel account={form} />

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8"><div className="flex items-center justify-between"><h2 className="text-lg font-black">Request History</h2><span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-black">{requestHistory.length}</span></div><div className="mt-4 space-y-2">{requestHistory.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">{item.subject}</p><p className="mt-0.5 text-[10px] font-bold uppercase text-slate-400">{item.type} · {formatDate(item.createdAt)}</p></div><RequestStatus status={item.status} /></div><p className="mt-2 text-xs leading-5 text-slate-600">{item.message}</p>{item.adminNote && <p className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs font-semibold">ARK: {item.adminNote}</p>}</article>)}{requestHistory.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">No requests for this account.</p>}</div></section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8"><h2 className="text-lg font-black">Account Control</h2><p className="mt-1 text-xs leading-5 text-slate-500">Payment restriction is automated. Permanent deletion is always your manual decision.</p><div className="mt-4 grid grid-cols-3 gap-2">{form.status === "disabled" ? <button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("restore")} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-800 disabled:opacity-50">Restore</button> : <button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("disable")} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-800 disabled:opacity-50">Disable</button>}<button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("delete-now")} className="rounded-xl bg-red-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Delete Permanently</button><button type="submit" disabled={isSaving || form.status === "disabled"} className="rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : "Save Profile"}</button></div></section>
          </form>
        )}
      </div>
    </main>
  );
}
