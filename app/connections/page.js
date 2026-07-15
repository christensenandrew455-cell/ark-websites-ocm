"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const EMPTY_CONNECTION = {
  clientId: "",
  businessName: "",
  enabled: true,
  websiteUrl: "",
  businessPhone: "",
  notificationPhone: "",
  notificationEmail: "",
  sourceLabel: "",
  defaultStage: "contactedMe",
  allowStageOverride: false,
  notes: "",
  connectionKey: "",
  websiteWebhookUrl: "",
  phoneWebhookUrl: "",
};

const STAGES = [
  ["contactedMe", "Contacted Me"],
  ["preClients", "Pre Clients"],
  ["clients", "Clients"],
  ["postClients", "Post Clients"],
];

function Field({ label, children, description }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {description && <span className="mt-1 block text-xs text-slate-500">{description}</span>}
    </label>
  );
}

function CopyField({ label, value, onCopy }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 flex gap-2">
        <input readOnly value={value || "Save this connection to generate a URL"} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-3 font-mono text-xs text-slate-700" />
        <button type="button" disabled={!value} onClick={() => onCopy(value)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:opacity-40">Copy</button>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const { user, isAdmin, loading } = useAuth();
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(EMPTY_CONNECTION);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
    if (selected) {
      setForm({ ...EMPTY_CONNECTION, ...selected });
      setMessage("");
      setError("");
    }
  }, [selected]);

  function updateField(field, value) {
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
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
      setMessage(regenerateKey ? "Connection key regenerated. Update the website and phone provider with the new URLs." : "Connection saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied to clipboard.");
    } catch {
      setError("The browser could not copy that value. Select it and copy manually.");
    }
  }

  if (loading || isLoading) {
    return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Loading connections…</main>;
  }

  if (!isAdmin) {
    return (
      <main className="grid min-h-[70vh] place-items-center p-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold">Administrator access required</h1>
          <p className="mt-3 text-slate-600">Only the ARK OCM administrator can manage website and phone connections.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-slate-500">Administrator</p>
          <h1 className="mt-2 text-4xl font-bold">Business Connections</h1>
          <p className="mt-3 max-w-3xl text-slate-600">Connect each customer website and phone provider without changing code. Every business receives its own private intake key and webhook URLs.</p>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {message && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">{message}</div>}

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Business accounts</h2>
            <p className="mt-1 text-xs text-slate-500">Only real registered accounts appear here.</p>
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
                  <span className="block truncate text-sm font-bold">{business.businessName}</span>
                  <span className={selectedId === business.clientId ? "mt-1 block truncate font-mono text-xs text-slate-300" : "mt-1 block truncate font-mono text-xs text-slate-500"}>{business.clientId}</span>
                </button>
              ))}
              {businesses.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No business accounts exist yet.</p>}
            </div>
          </aside>

          {selectedId ? (
            <form onSubmit={saveConnection} className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">{form.businessName}</h2>
                    <p className="mt-1 font-mono text-xs text-slate-500">{selectedId}</p>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold">
                    <input type="checkbox" checked={form.enabled} onChange={(event) => updateField("enabled", event.target.checked)} />
                    Connection enabled
                  </label>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <Field label="Website URL">
                    <input value={form.websiteUrl} onChange={(event) => updateField("websiteUrl", event.target.value)} placeholder="https://clientwebsite.com" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-950" />
                  </Field>
                  <Field label="Source label">
                    <input value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} placeholder="Website contact form" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-950" />
                  </Field>
                  <Field label="Business phone">
                    <input value={form.businessPhone} onChange={(event) => updateField("businessPhone", event.target.value)} placeholder="Customer-facing number" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-950" />
                  </Field>
                  <Field label="Lead notification phone">
                    <input value={form.notificationPhone} onChange={(event) => updateField("notificationPhone", event.target.value)} placeholder="Number that receives lead alerts" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-950" />
                  </Field>
                  <Field label="Lead notification email">
                    <input type="email" value={form.notificationEmail} onChange={(event) => updateField("notificationEmail", event.target.value)} placeholder="owner@example.com" className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-950" />
                  </Field>
                  <Field label="Default CRM stage" description="New website and phone leads normally enter Contacted Me.">
                    <select value={form.defaultStage} onChange={(event) => updateField("defaultStage", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-950">
                      {STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold md:col-span-2">
                    <input type="checkbox" checked={form.allowStageOverride} onChange={(event) => updateField("allowStageOverride", event.target.checked)} />
                    Allow the connected website or phone provider to choose a different CRM stage
                  </label>
                  <Field label="Admin notes">
                    <textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} rows={4} placeholder="Connection details, provider notes, or setup reminders" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-slate-950 md:col-span-2" />
                  </Field>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-bold">Private intake links</h2>
                <p className="mt-2 text-sm text-slate-600">Paste the website URL into the customer’s form integration. Paste the phone URL into the SMS/call provider’s inbound webhook settings.</p>
                <div className="mt-5 space-y-5">
                  <CopyField label="Website webhook URL" value={form.websiteWebhookUrl} onCopy={copy} />
                  <CopyField label="Phone webhook URL" value={form.phoneWebhookUrl} onCopy={copy} />
                  <CopyField label="Connection key" value={form.connectionKey} onCopy={copy} />
                </div>
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Regenerating the key immediately disconnects old webhook URLs. Use it when a key is exposed or when you intentionally want to reconnect a business from scratch.
                </div>
                <button type="button" disabled={isSaving} onClick={(event) => saveConnection(event, true)} className="mt-4 rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">Regenerate connection key</button>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-bold">Payload example</h2>
                <p className="mt-2 text-sm text-slate-600">The connected form can send any of these common field names. Leads are normalized before entering the CRM.</p>
                <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{`{
  "name": "Jane Customer",
  "phone": "978-555-0100",
  "email": "jane@example.com",
  "address": "10 Main Street",
  "service": "Interior painting",
  "message": "Please call after 4 PM"
}`}</pre>
              </section>

              <div className="flex justify-end">
                <button type="submit" disabled={isSaving} className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">{isSaving ? "Saving…" : "Save Connection"}</button>
              </div>
            </form>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">Create a business account before configuring a connection.</div>
          )}
        </div>
      </div>
    </main>
  );
}
