"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";
const stageNavItems = [
  { label: "Contacted Me", href: "/contacted-me" },
  { label: "Pre Clients", href: "/pre-clients" },
  { label: "Clients", href: "/clients" },
  { label: "Post Clients", href: "/post-clients" },
];
const utilityNavItems = [
  { label: "Review My Clients", href: "/review-my-clients" },
  { label: "Advertising", href: "/advertising" },
  { label: "Settings", href: "/settings" },
  { label: "Dashboard", href: "/" },
];
const DEFAULT_SETTINGS = {
  BusinessName: "",
  OwnerName: "",
  AccountEmail: "",
  AccountPhone: "",
  PlanName: "",
  MonthlyPrice: "",
  BillingEmail: "",
  BillingStatus: "",
  SubscriptionStartDate: "",
  NextBillingDate: "",
  PaymentMethodLabel: "",
  BillingAddress: "",
};

function cleanClientId(value) {
  return String(value || DEFAULT_CLIENT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || DEFAULT_CLIENT_ID;
}

function NavLink({ item, pathname, clientId }) {
  return (
    <Link
      href={`${item.href}?clientId=${clientId}`}
      className={pathname === item.href
        ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}
    >
      {item.label}
    </Link>
  );
}

function Field({ label, value, onChange, type = "text", options, multiline = false, placeholder = "" }) {
  return (
    <label className={multiline ? "md:col-span-2" : ""}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {multiline ? (
        <textarea value={value} onChange={onChange} rows={4} placeholder={placeholder} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-500" />
      ) : options ? (
        <select value={value} onChange={onChange} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-500">
          <option value="">Select...</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={onChange} placeholder={placeholder} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-500" />
      )}
    </label>
  );
}

export default function SettingsPanel() {
  const pathname = usePathname();
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(cleanClientId(params.get("clientId")));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError("");
    const settingsRef = doc(db, "ocmClients", clientId, "settings", "account");
    const unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        setForm({ ...DEFAULT_SETTINGS, ...(snapshot.exists() ? snapshot.data() : {}) });
        setIsLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load account settings. Check Firebase settings and permissions.");
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [clientId]);

  function updateField(field, value) {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    setIsSaving(true);
    setSaved(false);
    setError("");

    try {
      await setDoc(doc(db, "ocmClients", clientId, "settings", "account"), {
        ...form,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaved(true);
    } catch (saveError) {
      console.error(saveError);
      setError("Could not save account settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-8 overflow-x-auto pb-2">
          <div className="flex min-w-max items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <div className="flex gap-1">
              {stageNavItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} clientId={clientId} />)}
            </div>
            <div className="flex gap-1">
              {utilityNavItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} clientId={clientId} />)}
            </div>
          </div>
        </nav>

        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{clientId}</p>
          <h1 className="mt-1 text-4xl font-bold">Settings</h1>
          <p className="mt-2 max-w-3xl text-slate-600">Manage the business account, subscription, billing contacts, and payment-method reference.</p>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {saved && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">Settings saved.</div>}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading settings...</div>
        ) : (
          <form onSubmit={saveSettings} className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
              <h2 className="text-2xl font-bold">Account Information</h2>
              <p className="mt-1 text-sm text-slate-600">The primary business and account-owner details.</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Business Name" value={form.BusinessName} onChange={(event) => updateField("BusinessName", event.target.value)} />
                <Field label="Owner Name" value={form.OwnerName} onChange={(event) => updateField("OwnerName", event.target.value)} />
                <Field label="Account Email" type="email" value={form.AccountEmail} onChange={(event) => updateField("AccountEmail", event.target.value)} />
                <Field label="Account Phone" type="tel" value={form.AccountPhone} onChange={(event) => updateField("AccountPhone", event.target.value)} />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
              <h2 className="text-2xl font-bold">Billing & Subscription</h2>
              <p className="mt-1 text-sm text-slate-600">Subscription and billing records for this account.</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Plan Name" value={form.PlanName} onChange={(event) => updateField("PlanName", event.target.value)} placeholder="Example: Growth System" />
                <Field label="Monthly Price" type="number" value={form.MonthlyPrice} onChange={(event) => updateField("MonthlyPrice", event.target.value)} placeholder="1000" />
                <Field label="Billing Email" type="email" value={form.BillingEmail} onChange={(event) => updateField("BillingEmail", event.target.value)} />
                <Field label="Billing Status" value={form.BillingStatus} onChange={(event) => updateField("BillingStatus", event.target.value)} options={["Active", "Trial", "Past Due", "Paused", "Canceled"]} />
                <Field label="Subscription Start Date" type="date" value={form.SubscriptionStartDate} onChange={(event) => updateField("SubscriptionStartDate", event.target.value)} />
                <Field label="Next Billing Date" type="date" value={form.NextBillingDate} onChange={(event) => updateField("NextBillingDate", event.target.value)} />
                <Field label="Payment Method" value={form.PaymentMethodLabel} onChange={(event) => updateField("PaymentMethodLabel", event.target.value)} placeholder="Example: Visa ending in 4242" />
                <Field label="Billing Address" value={form.BillingAddress} onChange={(event) => updateField("BillingAddress", event.target.value)} multiline />
              </div>
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Store only a payment-method label here. Full card numbers, expiration dates, and security codes should stay inside the payment processor.
              </div>
            </section>

            <div className="flex justify-end">
              <button type="submit" disabled={isSaving} className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-400">
                {isSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
