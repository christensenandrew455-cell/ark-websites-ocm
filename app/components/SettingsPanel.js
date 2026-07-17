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
    <label>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 outline-none transition focus:border-slate-950"
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
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">{businessLabel}</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">Settings</h1>
          <p className="mt-2 max-w-2xl leading-7 text-slate-600">
            Manage the basic business and notification details used by the client collection center.
          </p>
        </header>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {saved && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">Settings saved.</div>}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading settings…</div>
        ) : (
          <form onSubmit={saveSettings} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <h2 className="text-2xl font-black">Business Details</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              These details identify the business and determine where important client notifications should go.
            </p>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
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

            <div className="mt-7 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:bg-slate-400"
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
