"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

const DEFAULT_SETTINGS = {
  BusinessName: "",
  OwnerName: "",
  AccountEmail: "",
  AccountPhone: "",
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
  const { profile } = useAuth();
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

  const businessLabel = form.BusinessName || profile?.businessName || "Your Business";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 sm:mb-7">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 sm:text-xs sm:tracking-[0.24em]">{businessLabel}</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:mt-2 sm:text-4xl">Settings</h1>
          <p className="mt-2 hidden max-w-2xl leading-7 text-slate-600 sm:block">
            Manage the basic business and notification details used by the client collection center.
          </p>
        </header>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:mb-5 sm:p-4">{error}</div>}
        {saved && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700 sm:mb-5 sm:p-4">Settings saved.</div>}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 sm:p-10">Loading settings…</div>
        ) : (
          <form onSubmit={saveSettings} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6 md:p-8">
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
        )}
      </div>
    </main>
  );
}
