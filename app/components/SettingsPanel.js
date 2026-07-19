"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

const DEFAULT_SETTINGS = {
  BusinessName: "",
  OwnerName: "",
  AccountEmail: "",
  AccountPhone: "",
  BillingStatus: "",
  PaymentMethodLabel: "",
  StripeCustomerId: "",
};

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-xs">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-slate-950 sm:h-12 sm:rounded-xl sm:px-4"
      />
    </label>
  );
}

export default function SettingsPanel() {
  const { user, profile, isAdmin } = useAuth();
  const clientId = profile?.clientId || "";
  const [form, setForm] = useState({
    ...DEFAULT_SETTINGS,
    BusinessName: profile?.businessName || "",
    OwnerName: profile?.ownerName || "",
    AccountEmail: profile?.accountEmail || "",
    AccountPhone: profile?.accountPhone || "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setError("This account does not have a business assigned yet.");
      setIsLoading(false);
      return undefined;
    }

    const settingsRef = doc(db, "ocmClients", clientId, "settings", "account");
    const unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        setForm({
          ...DEFAULT_SETTINGS,
          BusinessName: profile?.businessName || "",
          OwnerName: profile?.ownerName || "",
          AccountEmail: profile?.accountEmail || "",
          AccountPhone: profile?.accountPhone || "",
          ...(snapshot.exists() ? snapshot.data() : {}),
        });
        setIsLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load this business's settings.");
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [clientId, profile?.accountEmail, profile?.accountPhone, profile?.businessName, profile?.ownerName]);

  function updateField(field, value) {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!clientId) return;
    setIsSaving(true);
    setSaved(false);
    setError("");

    try {
      await setDoc(doc(db, "ocmClients", clientId, "settings", "account"), {
        BusinessName: form.BusinessName,
        OwnerName: form.OwnerName,
        AccountEmail: form.AccountEmail,
        AccountPhone: form.AccountPhone,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaved(true);
    } catch (saveError) {
      console.error(saveError);
      setError("Could not save this business's settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function openBillingPortal() {
    if (!user || isOpeningBilling) return;
    setIsOpeningBilling(true);
    setError("");

    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/create-portal-session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Could not open secure billing settings.");
      }
      window.location.assign(data.url);
    } catch (billingError) {
      console.error(billingError);
      setError(billingError.message || "Could not open secure billing settings.");
      setIsOpeningBilling(false);
    }
  }

  const paymentLabel = form.PaymentMethodLabel || "No payment method label is available yet.";
  const billingStatus = form.BillingStatus || "Not configured";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 sm:mb-7">
          {!isAdmin && (
            <Link href="/" className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-950 sm:text-sm">
              <span aria-hidden="true">←</span>
              Back to Clients
            </Link>
          )}
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>
          <p className="mt-2 hidden max-w-2xl leading-7 text-slate-600 sm:block">
            Manage the basic business, billing, and notification details used by the client collection center.
          </p>
        </header>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:mb-5 sm:p-4">{error}</div>}
        {saved && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700 sm:mb-5 sm:p-4">Settings saved.</div>}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 sm:p-10">Loading settings…</div>
        ) : (
          <>
            <form id="business-details" onSubmit={saveSettings} className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6 md:p-8">
              <h2 className="text-lg font-black sm:text-2xl">Business Details</h2>
              <p className="mt-1 hidden text-sm leading-6 text-slate-600 sm:block">
                These details identify the business and determine where important client notifications should go.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-5">
                <Field
                  label="Business Name"
                  value={form.BusinessName}
                  onChange={(event) => updateField("BusinessName", event.target.value)}
                />
                <Field
                  label="Owner Name"
                  value={form.OwnerName}
                  onChange={(event) => updateField("OwnerName", event.target.value)}
                />
                <Field
                  label="Notification Email"
                  type="email"
                  value={form.AccountEmail}
                  onChange={(event) => updateField("AccountEmail", event.target.value)}
                  placeholder="owner@example.com"
                />
                <Field
                  label="Notification Phone"
                  type="tel"
                  value={form.AccountPhone}
                  onChange={(event) => updateField("AccountPhone", event.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>

              <div className="mt-4 sm:mt-7 sm:flex sm:justify-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:bg-slate-400 sm:w-auto"
                >
                  {isSaving ? "Saving…" : "Save Settings"}
                </button>
              </div>
            </form>

            {!isAdmin && (
              <>
                <section id="billing" className="scroll-mt-28 mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Secure billing</p>
                      <h2 className="mt-1 text-lg font-black sm:text-2xl">Payment Method</h2>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{billingStatus}</span>
                  </div>
                  <p className="mt-3 text-sm font-bold text-slate-800">{paymentLabel}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Stripe opens a secure hosted page where you can replace or update the card attached to this account.</p>
                  <button
                    type="button"
                    onClick={openBillingPortal}
                    disabled={isOpeningBilling}
                    className="mt-4 w-full rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-indigo-300 sm:w-auto"
                  >
                    {isOpeningBilling ? "Opening Stripe…" : "Manage Payment Method"}
                  </button>
                </section>

                <section id="requests" className="scroll-mt-28 mt-4 grid grid-cols-2 gap-3 sm:mt-6">
                  <Link href="/messages?type=change" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.99] sm:p-6">
                    <p className="text-2xl font-black">Change</p>
                    <h2 className="mt-1 text-sm font-black">Request a Change</h2>
                    <p className="mt-2 text-[10px] font-semibold leading-4 text-slate-500 sm:text-xs sm:leading-5">Wording, voice, hours, business information, data exports, or another routine update.</p>
                  </Link>
                  <Link href="/messages?type=help" className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm active:scale-[0.99] sm:p-6">
                    <p className="text-2xl font-black text-red-600">Help</p>
                    <h2 className="mt-1 text-sm font-black">Priority Support</h2>
                    <p className="mt-2 text-[10px] font-semibold leading-4 text-slate-500 sm:text-xs sm:leading-5">Only for serious problems such as broken calls, missing lead data, or urgent account issues.</p>
                  </Link>
                </section>

                <section id="policies" className="scroll-mt-28 mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Learn and review</p>
                  <h2 className="mt-1 text-lg font-black sm:text-2xl">Docs, Terms, and Privacy</h2>
                  <p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">Learn how the app works and review recurring billing, cancellation, data access, retention, and privacy practices.</p>
                  <Link href="/docs" className="mt-4 block rounded-xl bg-slate-950 px-3 py-3 text-center text-xs font-black text-white hover:bg-slate-800 sm:text-sm">Open Docs and Learn More</Link>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Link href="/terms" className="rounded-xl border border-slate-300 px-3 py-2.5 text-center text-xs font-black text-slate-800 hover:bg-slate-50 sm:text-sm">Terms of Use</Link>
                    <Link href="/privacy" className="rounded-xl border border-slate-300 px-3 py-2.5 text-center text-xs font-black text-slate-800 hover:bg-slate-50 sm:text-sm">Privacy Policy</Link>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
