"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "../components/ReceptionistBusinessForm";
import { normalizeClientId } from "../lib/valueUtils";

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
  paymentMethodLabel: "",
  stripeSubscriptionStatus: "",
  receptionistPlan: { key: "starter-25", name: "Starter 25", includedCalls: 25, monthlyCents: 4900, overageCents: 150 },
  pendingReceptionistPlan: null,
  currentBillingMonth: "",
  currentMonthCallCount: 0,
  currentMonthIncludedCalls: 25,
  currentMonthOverageCalls: 0,
  currentMonthOverageAmount: 0,
  currentMonthAmountDue: 4900,
  currentMonthCurrency: "usd",
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
  connectionPhone: "",
};

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

function CountBadge({ value }) {
  return <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">{value}</span>;
}

function Pill({ children }) {
  return <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[9px] font-black uppercase text-slate-700">{children}</span>;
}

function AccountStatus({ account }) {
  if (account.status === "approved_pending_payment") return <Pill>Payment Setup</Pill>;
  if (!account.receptionistConfigured) return <Pill>Setup Pending</Pill>;
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

function BillingDetailsPanel({ account }) {
  const plan = account.receptionistPlan || EMPTY_ACCOUNT.receptionistPlan;
  const includedCalls = Math.max(0, Number(account.currentMonthIncludedCalls || plan.includedCalls || 0));
  const callsUsed = Math.max(0, Number(account.currentMonthCallCount || 0));
  const callsRemaining = Math.max(0, includedCalls - callsUsed);
  const pending = account.pendingReceptionistPlan;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Private account billing</p>
          <h2 className="mt-1 text-lg font-black sm:text-2xl">Receptionist Plan and Payment</h2>
        </div>
        <Pill>{account.stripeSubscriptionStatus || "Not configured"}</Pill>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Current plan</p><p className="mt-1 text-sm font-black">{plan.name}</p><p className="mt-1 text-[11px] font-semibold text-slate-500">{formatMoney(plan.monthlyCents)} monthly</p></div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Included and overage</p><p className="mt-1 text-sm font-black">{Number(plan.includedCalls || 0).toLocaleString()} calls</p><p className="mt-1 text-[11px] font-semibold text-slate-500">{formatMoney(plan.overageCents)} per extra call</p></div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Payment method</p><p className="mt-1 break-words text-sm font-black">{account.paymentMethodLabel || "No payment method recorded"}</p></div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Amount due</p><p className="mt-1 text-sm font-black">{formatMoney(account.currentMonthAmountDue, account.currentMonthCurrency)}</p><p className="mt-1 text-[11px] font-semibold text-slate-500">{account.currentBillingMonth || "Current month"}</p></div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-100 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Calls used</p><p className="mt-1 text-2xl font-black">{callsUsed.toLocaleString()}</p></div>
        <div className="rounded-xl bg-slate-100 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Calls remaining</p><p className="mt-1 text-2xl font-black">{callsRemaining.toLocaleString()}</p></div>
        <div className="rounded-xl bg-slate-100 p-3"><p className="text-[10px] font-black uppercase text-slate-500">Overage</p><p className="mt-1 text-2xl font-black">{Number(account.currentMonthOverageCalls || 0).toLocaleString()} calls</p><p className="mt-1 text-[11px] font-semibold text-slate-500">{formatMoney(account.currentMonthOverageAmount, account.currentMonthCurrency)}</p></div>
      </div>

      {pending && <p className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-bold text-slate-700">Pending: {pending.name} begins in {pending.effectiveMonth}. It includes {Number(pending.includedCalls || 0).toLocaleString()} calls at {formatMoney(pending.monthlyCents)} per month, then {formatMoney(pending.overageCents)} per extra call.</p>}
    </section>
  );
}

function AccountCard({ business, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(business.clientId)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-400">
      <div className="min-w-0">
        <span className="block truncate text-sm font-black">{business.businessName}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{business.ownerName || business.accountEmail}</span>
        <span className="mt-1 block truncate text-[10px] text-slate-400">{business.receptionistPlan?.name || "Starter 25"} · {business.receptionistPhone || business.phone || business.clientId}</span>
      </div>
      <AccountStatus account={business} />
    </button>
  );
}

function AccountSection({ businesses, onOpen, searchQuery, onSearchChange }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Accounts</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Open a customer account to manage its connection number, business information, AI settings, requests, billing details, and account controls.</p></div><CountBadge value={businesses.length} /></div>
      <input type="search" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search business, name, email, phone, or client ID" className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-slate-950" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{businesses.map((business) => <AccountCard key={business.clientId} business={business} onOpen={onOpen} />)}</div>
      {businesses.length === 0 && <p className="mt-4 rounded-xl border border-slate-200 p-5 text-center text-sm font-semibold text-slate-500">{searchQuery ? "No accounts match that search." : "No active customer accounts."}</p>}
    </section>
  );
}

export default function ConnectionsPage() {
  const router = useRouter();
  const { user, isAdmin, loading } = useAuth();
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState(EMPTY_ACCOUNT);
  const [receptionist, setReceptionist] = useState(null);
  const [requestHistory, setRequestHistory] = useState([]);
  const [newCustomer, setNewCustomer] = useState(EMPTY_CUSTOMER);
  const [showCreate, setShowCreate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => businesses.find((business) => business.clientId === selectedId) || null, [businesses, selectedId]);
  const visibleAccounts = useMemo(() => {
    const accounts = businesses.filter((business) => business.status !== "disabled");
    const query = searchQuery.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((business) => [business.businessName, business.ownerName, business.accountEmail, business.phone, business.receptionistPhone, business.clientId].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [businesses, searchQuery]);

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
    if (loading) return;
    if (!isAdmin) {
      setIsLoading(false);
      router.replace("/");
      return;
    }
    loadBusinesses().catch((loadError) => setError(loadError.message)).finally(() => setIsLoading(false));
  }, [isAdmin, loading, router, user]);

  useEffect(() => {
    if (!selected) {
      setForm(EMPTY_ACCOUNT);
      setReceptionist(null);
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
      setReceptionist(prepareReceptionistProfile(profile.profile));
    }).catch((loadError) => setError(loadError.message));
  }, [selected]);

  function updateNewCustomer(field, value) {
    setNewCustomer((current) => {
      const next = { ...current, [field]: value };
      if (field === "businessName" && (!current.clientId || current.clientId === normalizeClientId(current.businessName))) next.clientId = normalizeClientId(value);
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
          receptionistPhone: newCustomer.connectionPhone,
        }),
      });
      await loadBusinesses(result.clientId);
      setNewCustomer(EMPTY_CUSTOMER);
      setShowCreate(false);
      setMessage(`${result.businessName} was created. Open the account to finish its business information.`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setIsCreating(false);
    }
  }

  async function saveConnectionPhone() {
    if (!selectedId || !receptionist || isSavingConnection) return;
    setIsSavingConnection(true);
    setError("");
    try {
      const result = await adminFetch("/api/receptionist/settings", {
        method: "POST",
        body: JSON.stringify({ clientId: selectedId, connectionOnly: true, receptionistPhone: receptionist.receptionistPhone }),
      });
      const nextProfile = prepareReceptionistProfile(result.profile);
      setReceptionist(nextProfile);
      setBusinesses((current) => current.map((business) => business.clientId === selectedId ? { ...business, receptionistPhone: nextProfile.receptionistPhone } : business));
      setMessage("Connection phone number saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSavingConnection(false);
    }
  }

  async function saveProfile() {
    if (!selectedId || !receptionist || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const accountResult = await adminFetch("/api/admin/connections", {
        method: "POST",
        body: JSON.stringify({ ...form, clientId: selectedId }),
      });
      const receptionistResult = await adminFetch("/api/receptionist/settings", {
        method: "POST",
        body: JSON.stringify({ ...receptionistRequestPayload(receptionist), clientId: selectedId }),
      });
      const nextProfile = prepareReceptionistProfile(receptionistResult.profile);
      setReceptionist(nextProfile);
      const nextAccount = {
        ...accountResult.connection,
        receptionistConfigured: true,
        receptionistEnabled: nextProfile.enabled,
        receptionistPhone: nextProfile.receptionistPhone,
      };
      setBusinesses((current) => current.map((business) => business.clientId === selectedId ? nextAccount : business));
      setForm(nextAccount);
      setMessage("Account and AI receptionist settings saved.");
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

  if (loading || isLoading || !isAdmin) return <main className="grid min-h-[70vh] place-items-center p-6 text-sm font-semibold text-slate-500">Opening accounts…</main>;

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
              <Field label="Connection phone number" hint="The phone number callers use to reach this customer's AI receptionist."><Input value={newCustomer.connectionPhone} onChange={(event) => updateNewCustomer("connectionPhone", event.target.value)} placeholder="+1 774 245 3383" /></Field>
              <Field label="Temporary password"><Input type="password" value={newCustomer.temporaryPassword} onChange={(event) => updateNewCustomer("temporaryPassword", event.target.value)} /></Field>
              <Field label="Client ID"><Input value={newCustomer.clientId} onChange={(event) => updateNewCustomer("clientId", normalizeClientId(event.target.value))} /></Field>
            </div>
            <button disabled={isCreating} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{isCreating ? "Creating…" : "Create Customer"}</button>
          </form>
        )}

        {!showCreate && !selectedId && <AccountSection businesses={visibleAccounts} onOpen={setSelectedId} searchQuery={searchQuery} onSearchChange={setSearchQuery} />}

        {selectedId && receptionist && (
          <div className="space-y-4 sm:space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-black sm:text-3xl">{form.businessName}</h2><AccountStatus account={form} /></div><p className="mt-1 font-mono text-[10px] text-slate-500">{selectedId}</p></div><button type="button" onClick={() => setSelectedId("")} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button></div>
              <h3 className="mt-6 text-lg font-black">Account Setup</h3>
              <label className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black">Account enabled<input type="checkbox" disabled={form.status === "disabled"} checked={form.enabled && form.status !== "disabled"} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /></label>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Name"><Input value={form.ownerName} onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))} /></Field>
                <Field label="Email"><Input value={form.accountEmail} readOnly /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></Field>
                <Field label="Account name"><Input value={form.sourceLabel} onChange={(event) => setForm((current) => ({ ...current, sourceLabel: event.target.value }))} /></Field>
                <Field label="Connection phone number" hint="This called number connects the caller to this customer's receptionist." wide><div className="flex gap-2"><Input value={receptionist.receptionistPhone} onChange={(event) => setReceptionist((current) => ({ ...current, receptionistPhone: event.target.value }))} placeholder="+1 774 245 3383" /><button type="button" onClick={saveConnectionPhone} disabled={isSavingConnection} className="mt-1.5 rounded-xl bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-50">{isSavingConnection ? "Saving…" : "Save Number"}</button></div></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              <div><h2 className="text-xl font-black">AI Receptionist and Business Information</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Edit the same business and AI settings the customer sees during setup.</p></div>
              <div className="mt-6"><ReceptionistBusinessForm profile={receptionist} onChange={setReceptionist} adminMode /></div>
            </section>

            <BillingDetailsPanel account={form} />
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
