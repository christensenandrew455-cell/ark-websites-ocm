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
  deletionScheduledFor: "",
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
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function Field({ label, description, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{label}</span>
      {children}
      {description && <span className="mt-1 block text-[10px] leading-4 text-slate-500 sm:text-xs sm:leading-5">{description}</span>}
    </label>
  );
}

function Input({ value, onChange, type = "text", placeholder = "", readOnly = false }) {
  return (
    <input
      type={type}
      value={value || ""}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      className={readOnly
        ? "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600 sm:mt-2 sm:h-11"
        : "mt-1.5 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950 sm:mt-2 sm:h-11"}
    />
  );
}

function CopyField({ value, onCopy }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">OCM Connection Key</p>
      <div className="mt-1.5 flex items-center gap-2 sm:mt-2">
        <input
          readOnly
          value={value || "No connection key saved"}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 font-mono text-[10px] text-slate-700 sm:h-11 sm:text-xs"
        />
        <button type="button" disabled={!value} onClick={() => onCopy(value)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40 sm:px-4 sm:py-2.5 sm:text-sm">Copy</button>
      </div>
    </div>
  );
}

function StatusPill({ status, scheduled }) {
  if (scheduled) return <span className="rounded-full bg-red-100 px-2.5 py-1 text-[9px] font-black uppercase text-red-700">Deletion Scheduled</span>;
  if (status === "disabled") return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase text-amber-800">Disabled</span>;
  return <span className="rounded-full bg-green-100 px-2.5 py-1 text-[9px] font-black uppercase text-green-800">Active</span>;
}

function LegalAgreementPanel({ account }) {
  const accepted = account.termsAccepted && account.privacyAccepted && account.legalAcceptedAt;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Account evidence</p>
          <h2 className="mt-1 text-lg font-black sm:text-2xl">Legal Agreement</h2>
        </div>
        <span className={accepted
          ? "rounded-full bg-green-100 px-2.5 py-1 text-[9px] font-black uppercase text-green-800"
          : "rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-black uppercase text-amber-800"}
        >
          {accepted ? "Accepted" : "Not Recorded"}
        </span>
      </div>

      {accepted ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Terms of Use</p>
            <p className="mt-1 text-sm font-black text-slate-950">Accepted</p>
            <Link href="/terms" target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-blue-700 underline">Version {account.termsVersion || "not labeled"}</Link>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Privacy Policy</p>
            <p className="mt-1 text-sm font-black text-slate-950">Accepted</p>
            <Link href="/privacy" target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-blue-700 underline">Version {account.privacyVersion || "not labeled"}</Link>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Accepted by</p>
            <p className="mt-1 break-all text-sm font-bold text-slate-800">{account.legalAcceptedBy || account.accountEmail}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Accepted on</p>
            <p className="mt-1 text-sm font-bold text-slate-800">{formatDateTime(account.legalAcceptedAt)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900 sm:text-sm">
          No signup agreement record is stored for this account. This can happen for older accounts or accounts created manually by an administrator.
        </p>
      )}
    </section>
  );
}

export default function ConnectionsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(EMPTY_CONNECTION);
  const [newCustomer, setNewCustomer] = useState(EMPTY_CUSTOMER);
  const [showCreate, setShowCreate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => businesses.find((business) => business.clientId === selectedId) || null,
    [businesses, selectedId]
  );

  async function adminFetch(url, options = {}) {
    const token = await user.getIdToken(true);
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The administrator request failed.");
    return data;
  }

  async function loadBusinesses(preferredId = "") {
    const data = await adminFetch("/api/admin/connections");
    const nextBusinesses = data.businesses || [];
    setBusinesses(nextBusinesses);

    if (preferredId && nextBusinesses.some((business) => business.clientId === preferredId)) {
      setSelectedId(preferredId);
      setForm(nextBusinesses.find((business) => business.clientId === preferredId) || EMPTY_CONNECTION);
      return;
    }

    setSelectedId("");
    setForm(EMPTY_CONNECTION);
  }

  useEffect(() => {
    if (loading || !user || !isAdmin) {
      if (!loading) setIsLoading(false);
      return;
    }

    let active = true;
    adminFetch("/api/admin/connections")
      .then((data) => {
        if (!active) return;
        setBusinesses(data.businesses || []);
        setSelectedId("");
        setForm(EMPTY_CONNECTION);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin, loading, user]);

  useEffect(() => {
    if (!selected) {
      setForm(EMPTY_CONNECTION);
      return;
    }
    setForm({ ...EMPTY_CONNECTION, ...selected });
    setMessage("");
    setError("");
  }, [selected]);

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
    setMessage("");
    try {
      const result = await adminFetch("/api/admin/businesses", {
        method: "POST",
        body: JSON.stringify(newCustomer),
      });
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
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await adminFetch("/api/admin/connections", {
        method: "POST",
        body: JSON.stringify({ ...form, clientId: selectedId, regenerateKey }),
      });
      const connection = data.connection;
      setBusinesses((current) => current.map((business) => business.clientId === selectedId ? connection : business));
      setForm(connection);
      setMessage(regenerateKey
        ? "The connection key was regenerated. Replace the old key in Railway before the next call."
        : "Customer setup saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function regenerateConnectionKey() {
    if (!window.confirm("Regenerate this connection key? The old key will stop working immediately.")) return;
    await saveConnection(null, true);
  }

  async function lifecycleAction(action) {
    if (!selectedId || lifecycleBusy) return;
    let confirmation = "";
    if (action === "disable" && !window.confirm("Disable this customer now? Their login and receptionist connection will stop working.")) return;
    if (action === "restore" && !window.confirm("Restore this customer account and receptionist connection?")) return;
    if (action === "schedule-delete" && !window.confirm("Disable this customer now and permanently delete the account after seven days?")) return;
    if (action === "delete-now") {
      confirmation = window.prompt(`Permanent deletion cannot be undone. Type ${selectedId} to continue.`) || "";
      if (confirmation !== selectedId) return;
    }

    setLifecycleBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await adminFetch("/api/admin/customers/lifecycle", {
        method: "POST",
        body: JSON.stringify({ clientId: selectedId, action, confirmation }),
      });
      if (action === "delete-now") {
        await loadBusinesses();
        setMessage("Customer account permanently deleted.");
      } else {
        await loadBusinesses(selectedId);
        setMessage(action === "schedule-delete"
          ? `Customer disabled. Permanent deletion is scheduled for ${formatDate(data.result.deletionScheduledFor)}.`
          : action === "restore" ? "Customer account restored." : "Customer account disabled.");
      }
    } catch (lifecycleError) {
      setError(lifecycleError.message);
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Connection key copied.");
    } catch {
      setError("The browser could not copy that value. Select it and copy manually.");
    }
  }

  function openCustomer(clientId) {
    setSelectedId(clientId);
    setShowCreate(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading || isLoading) return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Loading connections…</main>;
  if (!isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Administrator access required</h1></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-end justify-between gap-3 sm:mb-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 sm:text-xs">Administrator</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:mt-2 sm:text-4xl">Connections</h1>
          </div>
          <button type="button" onClick={() => { setShowCreate((current) => !current); setSelectedId(""); }} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white sm:px-5 sm:py-3 sm:text-sm">{showCreate ? "Close" : "Add Customer"}</button>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {message && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{message}</div>}

        {showCreate && (
          <form onSubmit={createCustomer} className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mb-7 sm:rounded-3xl sm:p-8">
            <div className="mb-4 sm:mb-6"><h2 className="text-xl font-black sm:text-2xl">New Customer</h2><p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Creates the login, isolated OCM account, and private connection key.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <Field label="Business name"><Input value={newCustomer.businessName} onChange={(event) => updateNewCustomer("businessName", event.target.value)} placeholder="Example Painting" /></Field>
              <Field label="Client ID"><Input value={newCustomer.clientId} onChange={(event) => updateNewCustomer("clientId", slug(event.target.value))} placeholder="example-painting" /></Field>
              <Field label="Owner name"><Input value={newCustomer.ownerName} onChange={(event) => updateNewCustomer("ownerName", event.target.value)} /></Field>
              <Field label="Customer email"><Input type="email" value={newCustomer.accountEmail} onChange={(event) => updateNewCustomer("accountEmail", event.target.value)} /></Field>
              <Field label="Temporary password"><Input type="password" value={newCustomer.temporaryPassword} onChange={(event) => updateNewCustomer("temporaryPassword", event.target.value)} /></Field>
              <Field label="Business phone"><Input value={newCustomer.businessPhone} onChange={(event) => updateNewCustomer("businessPhone", event.target.value)} /></Field>
              <Field label="Notification email"><Input type="email" value={newCustomer.notificationEmail} onChange={(event) => updateNewCustomer("notificationEmail", event.target.value)} /></Field>
              <Field label="Notification phone"><Input value={newCustomer.notificationPhone} onChange={(event) => updateNewCustomer("notificationPhone", event.target.value)} /></Field>
              <div className="col-span-2"><Field label="Source label"><Input value={newCustomer.sourceLabel} onChange={(event) => updateNewCustomer("sourceLabel", event.target.value)} placeholder="Business receptionist" /></Field></div>
            </div>
            <div className="mt-4 flex justify-end sm:mt-6"><button disabled={isCreating} className="rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50 sm:px-6 sm:py-3 sm:text-sm">{isCreating ? "Creating…" : "Create Customer"}</button></div>
          </form>
        )}

        {!showCreate && !selectedId && (
          <>
            <div className="mb-3 w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mb-5 sm:p-6"><p className="text-4xl font-black text-slate-950">{businesses.length}</p><h2 className="mt-1 text-sm font-black">Customer Accounts</h2><p className="mt-1 text-[10px] font-bold text-slate-400 sm:text-xs">Tap a customer to view the full profile and account controls</p></div>
            <section className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
              {businesses.map((business) => (
                <button key={business.clientId} type="button" onClick={() => openCustomer(business.clientId)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:scale-[0.99] sm:rounded-2xl sm:p-4">
                  <div className="min-w-0"><span className="block truncate text-sm font-black">{business.businessName}</span><span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{business.ownerName || business.accountEmail || business.clientId}</span></div>
                  <StatusPill status={business.status} scheduled={business.deletionScheduledFor} />
                </button>
              ))}
              {businesses.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm sm:col-span-2 lg:col-span-3">No customers exist yet.</p>}
            </section>
          </>
        )}

        {selectedId && (
          <form onSubmit={saveConnection} className="space-y-3 sm:space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-black sm:text-3xl">{form.businessName}</h2><StatusPill status={form.status} scheduled={form.deletionScheduledFor} /></div><p className="mt-0.5 truncate font-mono text-[10px] text-slate-500 sm:text-xs">{selectedId}</p></div>
                <button type="button" onClick={() => setSelectedId("")} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Close</button>
              </div>

              {form.deletionScheduledFor && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">Permanent deletion is scheduled for {formatDate(form.deletionScheduledFor)}. Restore the account to cancel deletion.</div>}

              <label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black sm:px-4 sm:py-3 sm:text-sm">OCM connection enabled<input type="checkbox" disabled={form.status === "disabled"} checked={form.enabled && form.status !== "disabled"} onChange={(event) => updateField("enabled", event.target.checked)} /></label>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4">
                <Field label="Owner name"><Input value={form.ownerName} onChange={(event) => updateField("ownerName", event.target.value)} /></Field>
                <Field label="Customer email"><Input value={form.accountEmail} readOnly /></Field>
                <Field label="Business phone"><Input value={form.businessPhone} onChange={(event) => updateField("businessPhone", event.target.value)} /></Field>
                <Field label="Notification email"><Input type="email" value={form.notificationEmail} onChange={(event) => updateField("notificationEmail", event.target.value)} /></Field>
                <Field label="Notification phone"><Input value={form.notificationPhone} onChange={(event) => updateField("notificationPhone", event.target.value)} /></Field>
                <Field label="Source label"><Input value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} /></Field>
              </div>
            </section>

            <LegalAgreementPanel account={form} />

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <h2 className="text-lg font-black sm:text-2xl">Private Connection Key</h2>
              <p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Authorizes this receptionist to send leads into this account.</p>
              <div className="mt-4 sm:mt-6"><CopyField value={form.connectionKey} onCopy={copy} /></div>
              <button type="button" disabled={isSaving || form.status === "disabled"} onClick={regenerateConnectionKey} className="mt-3 rounded-xl border border-red-300 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50 sm:mt-4 sm:px-4 sm:py-2.5 sm:text-sm">Regenerate Key</button>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <h2 className="text-lg font-black sm:text-2xl">Account Control</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Disable stops the login and receptionist immediately. Schedule deletion keeps the account disabled for seven days before permanent removal.</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {form.status === "disabled" ? <button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("restore")} className="rounded-xl bg-green-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Restore</button> : <button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("disable")} className="rounded-xl border border-amber-300 px-3 py-2.5 text-xs font-black text-amber-800 disabled:opacity-50">Disable</button>}
                <button type="button" disabled={lifecycleBusy || Boolean(form.deletionScheduledFor)} onClick={() => lifecycleAction("schedule-delete")} className="rounded-xl border border-red-300 px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete in 7 Days</button>
                <button type="button" disabled={lifecycleBusy} onClick={() => lifecycleAction("delete-now")} className="rounded-xl bg-red-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Delete Now</button>
                <button type="submit" disabled={isSaving || form.status === "disabled"} className="rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : "Save Profile"}</button>
              </div>
            </section>
          </form>
        )}
      </div>
    </main>
  );
}
