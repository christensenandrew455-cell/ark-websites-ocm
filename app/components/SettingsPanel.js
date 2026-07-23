"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "./ReceptionistBusinessForm";
import { chooseClientFileDestination, saveClientFile } from "../lib/clientFileSave";
import { db } from "../lib/firebase";

const DEFAULT_SETTINGS = {
  BillingStatus: "",
  PaymentMethodLabel: "",
  StripeCustomerId: "",
};

export default function SettingsPanel({ setupMode = false }) {
  const router = useRouter();
  const { user, profile, isAdmin, refreshProfile } = useAuth();
  const clientId = profile?.clientId || "";
  const [accountSettings, setAccountSettings] = useState(DEFAULT_SETTINGS);
  const [receptionist, setReceptionist] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setError("This account does not have a business assigned yet.");
      setIsLoading(false);
      return undefined;
    }

    const settingsRef = doc(db, "ocmClients", clientId, "settings", "account");
    return onSnapshot(
      settingsRef,
      (snapshot) => setAccountSettings({ ...DEFAULT_SETTINGS, ...(snapshot.exists() ? snapshot.data() : {}) }),
      () => setError("Could not load this business's account information."),
    );
  }, [clientId]);

  useEffect(() => {
    if (!user || !clientId || isAdmin) {
      setIsLoading(false);
      return undefined;
    }
    let active = true;
    user.getIdToken(true)
      .then((token) => fetch("/api/receptionist/settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load AI receptionist business information.");
        if (active) setReceptionist(prepareReceptionistProfile(data.profile));
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [clientId, isAdmin, user]);

  async function saveReceptionist(event) {
    event.preventDefault();
    if (!user || !receptionist || isSaving) return;
    setIsSaving(true);
    setSaved(false);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/receptionist/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(receptionistRequestPayload(receptionist)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save AI receptionist business information.");
      setReceptionist(prepareReceptionistProfile(data.profile));
      setSaved(true);
      if (setupMode) {
        await refreshProfile();
        router.replace("/");
      }
    } catch (saveError) {
      setError(saveError.message);
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
      const response = await fetch("/api/billing/create-portal-session", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open secure billing settings.");
      window.location.assign(data.url);
    } catch (billingError) {
      setError(billingError.message || "Could not open secure billing settings.");
      setIsOpeningBilling(false);
    }
  }

  async function downloadClientData() {
    if (!user || isDownloading) return;
    setIsDownloading(true);
    setDownloadNotice("");
    setError("");

    const suggestedName = `${clientId}-client-data.json`;
    try {
      const destination = await chooseClientFileDestination(suggestedName);
      if (destination.kind === "canceled") return;

      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/export", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Client data could not be downloaded.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || suggestedName;
      const result = await saveClientFile({ blob, fileName, destination });
      if (result?.saved) setDownloadNotice("Client data saved.");
    } catch (downloadError) {
      setError(downloadError.message || "Client data could not be downloaded.");
    } finally {
      setIsDownloading(false);
    }
  }

  if (isAdmin) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening administrator dashboard…</main>;

  const paymentLabel = accountSettings.PaymentMethodLabel || "No payment method label is available yet.";
  const billingStatus = accountSettings.BillingStatus || "Not configured";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4 sm:mb-7">
          {!setupMode && <Link href="/" className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm"><span aria-hidden="true">←</span>Back to Dashboard</Link>}
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{setupMode ? "Final account step" : "ARK Client Center"}</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{setupMode ? "Finish Business Setup" : "Settings"}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{setupMode ? "Complete the business and AI receptionist settings below before entering the main app." : "Manage business information, billing, downloads, help, and account resources."}</p>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {saved && !setupMode && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">Business information saved.</div>}
        {downloadNotice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{downloadNotice}</div>}

        <details defaultOpen={setupMode} className="group rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 sm:p-6 md:p-8 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">AI receptionist</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">Business Information</h2>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">View and edit the information and voice settings used during calls.</p>
            </div>
            <span className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black group-open:bg-slate-950 group-open:text-white">View and edit</span>
          </summary>
          <div className="border-t border-slate-200 p-4 sm:p-6 md:p-8">
            {isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading business information…</p> : (
              <form onSubmit={saveReceptionist}>
                <ReceptionistBusinessForm profile={receptionist} onChange={(next) => { setSaved(false); setReceptionist(next); }} />
                <button type="submit" disabled={isSaving} className="mt-7 w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isSaving ? "Saving…" : setupMode ? "Save and Open Client Center" : "Save Business Information"}</button>
              </form>
            )}
          </div>
        </details>

        {!setupMode && (
          <>
            <section id="billing" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Secure billing</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Payment Method</h2></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{billingStatus}</span></div><p className="mt-3 text-sm font-bold text-slate-800">{paymentLabel}</p><button type="button" onClick={openBillingPortal} disabled={isOpeningBilling} className="mt-4 w-full rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-indigo-300 sm:w-auto">{isOpeningBilling ? "Opening Stripe…" : "Manage Payment Method"}</button></section>

            <section id="account-data" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Your information</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Download Client Data</h2><p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">Choose where to save a JSON copy of your current records. The app does not receive ongoing access to your files.</p><button type="button" onClick={downloadClientData} disabled={isDownloading} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isDownloading ? "Preparing Download…" : "Choose File Location"}</button></section>

            <Link href="/help" className="mt-4 block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:p-6"><h2 className="text-lg font-black sm:text-2xl">Help</h2><p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">Go to Docs, ask the in-app AI, or send a message about an issue or account request.</p><span className="mt-4 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Open Help</span></Link>

            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Resources</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Policies and Documentation</h2><div className="mt-4 grid gap-2 sm:grid-cols-3"><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link><Link href="/docs" className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Go to Docs</Link></div></section>
          </>
        )}
      </div>
    </main>
  );
}
