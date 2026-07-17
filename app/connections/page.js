"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const EMPTY_CONNECTION = {
  clientId: "",
  businessName: "",
  ownerName: "",
  accountEmail: "",
  enabled: true,
  businessPhone: "",
  notificationPhone: "",
  notificationEmail: "",
  sourceLabel: "",
  connectionKey: "",
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

function Field({ label, description, children }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      {children}
      {description && <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>}
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
        ? "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600"
        : "mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"}
    />
  );
}

function CopyField({ value, onCopy }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">OCM Connection Key</p>
      <div className="mt-2 flex items-start gap-2">
        <input
          readOnly
          value={value || "Save the customer first."}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 font-mono text-xs text-slate-700"
        />
        <button
          type="button"
          disabled={!value}
          onClick={() => onCopy(value)}
          className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-100 disabled:opacity-40"
        >
          Copy
        </button>
      </div>
    </div>
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
    const nextId = preferredId || selectedId || nextBusinesses[0]?.clientId || "";
    const availableId = nextBusinesses.some((business) => business.clientId === nextId)
      ? nextId
      : nextBusinesses[0]?.clientId || "";
    setSelectedId(availableId);
    setForm(nextBusinesses.find((business) => business.clientId === availableId) || EMPTY_CONNECTION);
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
        const nextBusinesses = data.businesses || [];
        setBusinesses(nextBusinesses);
        const firstId = nextBusinesses[0]?.clientId || "";
        setSelectedId(firstId);
        setForm(nextBusinesses[0] || EMPTY_CONNECTION);
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
    if (!selected) return;
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
      if (field === "businessName" && (!current.clientId || current.clientId === slug(current.businessName))) {
        next.clientId = slug(value);
      }
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
      setBusinesses((current) => current.map((business) => (
        business.clientId === selectedId ? connection : business
      )));
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
    const confirmed = window.confirm(
      "Regenerate this connection key? The old key will stop working immediately."
    );
    if (!confirmed) return;
    await saveConnection(null, true);
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Connection key copied.");
    } catch {
      setError("The browser could not copy that value. Select it and copy manually.");
    }
  }

  if (loading || isLoading) {
    return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Loading customer setup…</main>;
  }

  if (!isAdmin) {
    return (
      <main className="grid min-h-[70vh] place-items-center p-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-black">Administrator access required</h1>
          <p className="mt-3 text-slate-600">Only the OCM administrator can create and manage customer accounts.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">Administrator</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Customer Setup</h1>
            <p className="mt-3 max-w-3xl text-slate-600">Create the customer account, choose where lead notifications go, and manage its private OCM connection key.</p>
          </div>
          <button type="button" onClick={() => setShowCreate((current) => !current)} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">
            {showCreate ? "Close New Customer" : "Add Customer"}
          </button>
        </div>

        {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
        {message && <div className="mb-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-800">{message}</div>}

        {showCreate && (
          <form onSubmit={createCustomer} className="mb-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-black">New Customer</h2>
              <p className="mt-2 text-sm text-slate-600">This creates the customer login, isolated OCM records, and private connection key.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Business name"><Input value={newCustomer.businessName} onChange={(event) => updateNewCustomer("businessName", event.target.value)} placeholder="Example Painting Company" /></Field>
              <Field label="Client ID" description="Permanent account ID. Use lowercase letters, numbers, and dashes."><Input value={newCustomer.clientId} onChange={(event) => updateNewCustomer("clientId", slug(event.target.value))} placeholder="example-painting-company" /></Field>
              <Field label="Owner name"><Input value={newCustomer.ownerName} onChange={(event) => updateNewCustomer("ownerName", event.target.value)} /></Field>
              <Field label="Customer login email"><Input type="email" value={newCustomer.accountEmail} onChange={(event) => updateNewCustomer("accountEmail", event.target.value)} /></Field>
              <Field label="Temporary password" description="Share this securely. The customer can change it later."><Input type="password" value={newCustomer.temporaryPassword} onChange={(event) => updateNewCustomer("temporaryPassword", event.target.value)} /></Field>
              <Field label="Business phone"><Input value={newCustomer.businessPhone} onChange={(event) => updateNewCustomer("businessPhone", event.target.value)} /></Field>
              <Field label="Lead notification email"><Input type="email" value={newCustomer.notificationEmail} onChange={(event) => updateNewCustomer("notificationEmail", event.target.value)} /></Field>
              <Field label="Lead notification phone"><Input value={newCustomer.notificationPhone} onChange={(event) => updateNewCustomer("notificationPhone", event.target.value)} /></Field>
              <Field label="Source label" description="How leads from this receptionist are labeled inside the OCM."><Input value={newCustomer.sourceLabel} onChange={(event) => updateNewCustomer("sourceLabel", event.target.value)} placeholder="Business receptionist" /></Field>
            </div>

            <div className="mt-6 flex justify-end">
              <button disabled={isCreating} className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50">{isCreating ? "Creating…" : "Create Customer"}</button>
            </div>
          </form>
        )}

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black">Customers</h2>
            <p className="mt-1 text-xs text-slate-500">Choose a customer to update.</p>
            <div className="mt-4 space-y-2">
              {businesses.map((business) => (
                <button
                  key={business.clientId}
                  type="button"
                  onClick={() => setSelectedId(business.clientId)}
                  className={selectedId === business.clientId
                    ? "w-full rounded-xl bg-slate-950 px-4 py-3 text-left text-white"
                    : "w-full rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"}
                >
                  <span className="block truncate text-sm font-black">{business.businessName}</span>
                  <span className={selectedId === business.clientId ? "mt-1 block truncate font-mono text-xs text-slate-300" : "mt-1 block truncate font-mono text-xs text-slate-500"}>{business.clientId}</span>
                </button>
              ))}
              {businesses.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No customers exist yet.</p>}
            </div>
          </aside>

          {selectedId ? (
            <form onSubmit={saveConnection} className="space-y-6">
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Customer</p>
                    <h2 className="mt-2 text-3xl font-black">{form.businessName}</h2>
                    <p className="mt-1 font-mono text-xs text-slate-500">{selectedId}</p>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black">
                    <input type="checkbox" checked={form.enabled} onChange={(event) => updateField("enabled", event.target.checked)} />
                    OCM connection enabled
                  </label>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <Field label="Owner name"><Input value={form.ownerName} onChange={(event) => updateField("ownerName", event.target.value)} /></Field>
                  <Field label="Customer login email"><Input value={form.accountEmail} readOnly /></Field>
                  <Field label="Business phone"><Input value={form.businessPhone} onChange={(event) => updateField("businessPhone", event.target.value)} /></Field>
                  <Field label="Lead notification email"><Input type="email" value={form.notificationEmail} onChange={(event) => updateField("notificationEmail", event.target.value)} /></Field>
                  <Field label="Lead notification phone"><Input value={form.notificationPhone} onChange={(event) => updateField("notificationPhone", event.target.value)} /></Field>
                  <Field label="Source label"><Input value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} placeholder="Business receptionist" /></Field>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                <h2 className="text-2xl font-black">Private Connection Key</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">This key authorizes the receptionist to send leads into this customer account.</p>

                <div className="mt-6">
                  <CopyField value={form.connectionKey} onCopy={copy} />
                </div>

                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  Regenerating the key stops the old key immediately. Replace it in Railway before the next phone call.
                </div>
                <button type="button" disabled={isSaving} onClick={regenerateConnectionKey} className="mt-4 rounded-xl border border-red-300 px-4 py-2.5 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50">Regenerate Connection Key</button>
              </section>

              <div className="flex justify-end">
                <button type="submit" disabled={isSaving} className="rounded-xl bg-slate-950 px-7 py-3 text-sm font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : "Save Customer Setup"}</button>
              </div>
            </form>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">Add the first customer to begin.</div>
          )}
        </div>
      </div>
    </main>
  );
}
