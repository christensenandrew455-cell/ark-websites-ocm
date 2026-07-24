"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "./ReceptionistBusinessForm";
import { androidNativeFileSaveAvailable, chooseClientFileDestination, saveClientFile, saveClientFileFromUrl } from "../lib/clientFileSave";
import { db } from "../lib/firebase";

const DEFAULT_SETTINGS = { BillingStatus: "", PaymentMethodLabel: "", StripeCustomerId: "" };
const THEME_KEY = "ark-theme-v1";
const SETTINGS_BLOCKS = [
  { key: "business", title: "Business Information", description: "Business details, hours, services, service areas, and estimate availability." },
  { key: "customization", title: "Customization", description: "App tools, Dark Mode, AI receptionist voice and timing, and client-data downloads." },
  { key: "payment", title: "Payment", description: "View the estimated monthly total and manage the payment method." },
  { key: "account", title: "Help & Account", description: "Help, documentation, policies, support, and account deletion." },
];

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function SettingsBlock({ title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition active:scale-[0.99] sm:min-h-32 sm:rounded-3xl sm:p-7">
      <h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">{description}</p>
    </button>
  );
}

function SectionHeader({ title, description, onBack }) {
  return (
    <div className="mb-4 sm:mb-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm"><span aria-hidden="true">←</span>Back to Settings</button>
      <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function SectionPanel({ children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">{children}</section>;
}

export default function SettingsPanel({ setupMode = false }) {
  const router = useRouter();
  const { user, profile, isAdmin, isOwner, refreshProfile, logout } = useAuth();
  const clientId = profile?.clientId || "";
  const [activeSection, setActiveSection] = useState("");
  const [accountSettings, setAccountSettings] = useState(DEFAULT_SETTINGS);
  const [receptionist, setReceptionist] = useState(null);
  const [features, setFeatures] = useState({ messagesEnabled: profile?.messagesEnabled === true, employeesEnabled: profile?.employeesEnabled === true, employeeMessagingEnabled: profile?.employeeMessagingEnabled === true });
  const [billingSummary, setBillingSummary] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const [featureNotice, setFeatureNotice] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const enabled = window.localStorage.getItem(THEME_KEY) === "dark";
      setDarkMode(enabled);
      document.documentElement.classList.toggle("ark-dark", enabled);
    } catch {
      setDarkMode(false);
    }
  }, []);

  useEffect(() => {
    if (!clientId) { setError("This account does not have a business assigned yet."); setIsLoading(false); return undefined; }
    return onSnapshot(doc(db, "ocmClients", clientId, "settings", "account"), (snapshot) => setAccountSettings({ ...DEFAULT_SETTINGS, ...(snapshot.exists() ? snapshot.data() : {}) }), () => setError("Could not load this account's billing information."));
  }, [clientId]);

  useEffect(() => {
    if (!user || !clientId || isAdmin) { setIsLoading(false); return undefined; }
    let active = true;
    user.getIdToken(true).then(async (token) => {
      const [receptionistResponse, featureResponse, billingResponse] = await Promise.all([
        fetch("/api/receptionist/settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/account/features", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/billing/monthly-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const receptionistData = await receptionistResponse.json().catch(() => ({}));
      const featureData = await featureResponse.json().catch(() => ({}));
      const billingData = await billingResponse.json().catch(() => ({}));
      if (!receptionistResponse.ok) throw new Error(receptionistData.error || "Could not load AI receptionist information.");
      if (!featureResponse.ok) throw new Error(featureData.error || "Could not load account features.");
      if (active) {
        setReceptionist(prepareReceptionistProfile(receptionistData.profile));
        setFeatures({ messagesEnabled: featureData.messagesEnabled === true, employeesEnabled: featureData.employeesEnabled === true, employeeMessagingEnabled: featureData.employeeMessagingEnabled === true });
        if (billingResponse.ok) setBillingSummary(billingData);
      }
    }).catch((loadError) => active && setError(loadError.message)).finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [clientId, isAdmin, user]);

  async function saveReceptionistProfile() {
    const token = await user.getIdToken(true);
    const response = await fetch("/api/receptionist/settings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(receptionistRequestPayload(receptionist)) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save AI receptionist information.");
    setReceptionist(prepareReceptionistProfile(data.profile));
    return token;
  }

  async function saveBusinessInformation(event) {
    event.preventDefault();
    if (!user || !receptionist || isSaving) return;
    setIsSaving(true); setSaved(false); setError("");
    try {
      await saveReceptionistProfile();
      setSaved(true);
      await refreshProfile();
      if (setupMode) router.replace("/");
    } catch (saveError) { setError(saveError.message); }
    finally { setIsSaving(false); }
  }

  function updateFeature(key, checked) {
    setFeatureNotice("");
    setFeatures((current) => {
      const next = { ...current, [key]: checked };
      if (!next.messagesEnabled || !next.employeesEnabled) next.employeeMessagingEnabled = false;
      return next;
    });
  }

  function updateTheme(checked) {
    setDarkMode(checked);
    try { window.localStorage.setItem(THEME_KEY, checked ? "dark" : "light"); } catch {}
    document.documentElement.classList.toggle("ark-dark", checked);
  }

  async function saveCustomization(event) {
    event.preventDefault();
    if (!user || !receptionist || isSavingCustomization) return;
    setIsSavingCustomization(true); setFeatureNotice(""); setError("");
    try {
      const token = await saveReceptionistProfile();
      const response = await fetch("/api/account/features", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(features) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update account features.");
      setFeatures(data);
      setFeatureNotice("Customization saved.");
      await refreshProfile();
    } catch (featureError) { setError(featureError.message); }
    finally { setIsSavingCustomization(false); }
  }

  async function openBillingPortal() {
    if (!user || isOpeningBilling) return;
    setIsOpeningBilling(true); setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/create-portal-session", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open secure billing settings.");
      window.location.assign(data.url);
    } catch (billingError) { setError(billingError.message || "Could not open secure billing settings."); setIsOpeningBilling(false); }
  }

  async function downloadClientData() {
    if (!user || isDownloading) return;
    setIsDownloading(true); setDownloadNotice(""); setError("");
    const suggestedName = `${clientId}-client-data.json`;
    try {
      const destination = await chooseClientFileDestination(suggestedName);
      if (destination.kind === "canceled") return;
      const token = await user.getIdToken(true);
      if (androidNativeFileSaveAvailable()) {
        const result = await saveClientFileFromUrl({ url: new URL("/api/account/export", window.location.origin).toString(), bearerToken: token, fileName: suggestedName });
        if (result?.saved) setDownloadNotice("Client data saved.");
        return;
      }
      const response = await fetch("/api/account/export", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Client data could not be downloaded."); }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || suggestedName;
      const result = await saveClientFile({ blob, fileName, destination });
      if (result?.saved) setDownloadNotice("Client data saved.");
    } catch (downloadError) { setError(downloadError.message || "Client data could not be downloaded."); }
    finally { setIsDownloading(false); }
  }

  async function deleteAccount() {
    if (!user || isDeleting || deleteConfirmation.trim().toLowerCase() !== String(profile?.businessName || "").trim().toLowerCase()) return;
    setIsDeleting(true); setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ confirmation: deleteConfirmation }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete the account.");
      await logout().catch(() => null);
      router.replace("/signup");
    } catch (deleteError) { setError(deleteError.message); setIsDeleting(false); }
  }

  if (isAdmin) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening administrator dashboard…</main>;
  const paymentLabel = accountSettings.PaymentMethodLabel || "No payment method label is available yet.";
  const billingStatus = accountSettings.BillingStatus || "Not configured";

  function businessSection() {
    return <><SectionHeader title="Business Information" description="Edit only the information the receptionist uses to understand and represent the business." onBack={() => setActiveSection("")} /><SectionPanel>{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading business information…</p> : <form onSubmit={saveBusinessInformation}><div className="settings-business-form"><ReceptionistBusinessForm profile={receptionist} onChange={(next) => { setSaved(false); setReceptionist(next); }} /></div><button type="submit" disabled={isSaving} className="mt-7 w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isSaving ? "Saving…" : "Save Business Information"}</button></form>}</SectionPanel></>;
  }

  function customizationSection() {
    return <><SectionHeader title="Customization" description="Change the app appearance, optional workspaces, AI voice behavior, and client-data download." onBack={() => setActiveSection("")} /><SectionPanel><form onSubmit={saveCustomization}>
      <section><h3 className="text-lg font-black">Appearance</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Choose the light or dark version of ARK Client Center.</p><label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span><strong className="block text-sm">Dark Mode</strong><span className="text-xs text-slate-500">Use darker backgrounds and lighter text throughout the app.</span></span><input type="checkbox" checked={darkMode} onChange={(event) => updateTheme(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label></section>
      <section className="mt-7"><h3 className="text-lg font-black">App Tools</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Choose which optional workspaces are available.</p><div className="mt-4 space-y-3"><label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span><strong className="block text-sm">Messages</strong><span className="text-xs text-slate-500">Enable customer conversations at $1 for each new chat.</span></span><input type="checkbox" checked={features.messagesEnabled} onChange={(event) => updateFeature("messagesEnabled", event.target.checked)} className="h-5 w-5 accent-slate-950" /></label><label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span><strong className="block text-sm">Employees</strong><span className="text-xs text-slate-500">Enable employee accounts, access controls, and assignments.</span></span><input type="checkbox" checked={features.employeesEnabled} onChange={(event) => updateFeature("employeesEnabled", event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>{features.messagesEnabled && features.employeesEnabled && <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span><strong className="block text-sm">Messages for Employees</strong><span className="text-xs text-slate-500">Allow approved employees to message only assigned leads.</span></span><input type="checkbox" checked={features.employeeMessagingEnabled} onChange={(event) => updateFeature("employeeMessagingEnabled", event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>}</div></section>
      <section className="mt-7"><h3 className="text-lg font-black">AI Receptionist</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Change the voice, speaking speed, and silence before replying.</p><div className="settings-ai-form mt-4">{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading AI settings…</p> : <ReceptionistBusinessForm profile={receptionist} onChange={(next) => setReceptionist(next)} />}</div></section>
      <section id="account-data" className="mt-7 border-t border-slate-200 pt-7"><h3 className="text-lg font-black">Client Data</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Download a JSON copy of current lead and client records.</p><button type="button" onClick={downloadClientData} disabled={isDownloading} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black disabled:opacity-50 sm:w-auto">{isDownloading ? "Preparing Download…" : "Download Client Data"}</button></section>
      <button type="submit" disabled={isSavingCustomization} className="mt-7 w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isSavingCustomization ? "Saving…" : "Save Customization"}</button>
    </form></SectionPanel></>;
  }

  function paymentSection() {
    return <><SectionHeader title="Payment" description="See the single estimated total for this month and manage the payment method." onBack={() => setActiveSection("")} /><SectionPanel><div className="rounded-2xl bg-slate-50 p-5 sm:p-7"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Estimated total cost this month</p><p className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">{money(billingSummary?.amountDue || 0)}</p></div><div className="mt-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Payment method</p><p className="mt-2 text-sm font-bold text-slate-800">{paymentLabel}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{billingStatus}</span></div><button type="button" onClick={openBillingPortal} disabled={isOpeningBilling} className="mt-5 w-full rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-indigo-300 sm:w-auto">{isOpeningBilling ? "Opening Stripe…" : "Manage Payment Method"}</button></SectionPanel></>;
  }

  function accountSection() {
    return <><SectionHeader title="Help & Account" description="Open help and documents, review policies, or permanently delete the account." onBack={() => setActiveSection("")} /><SectionPanel><section><h3 className="text-lg font-black">Help and Resources</h3><div className="mt-4 grid gap-2 sm:grid-cols-2"><Link href="/help" className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Open Help</Link><Link href="/docs" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Documentation</Link><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link></div></section><section className="mt-7 border-t border-red-200 pt-7"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-700">Danger zone</p><h3 className="mt-1 text-lg font-black text-red-950">Delete Account</h3><p className="mt-2 text-xs leading-5 text-red-800 sm:text-sm">This cancels the subscription and permanently deletes the owner account, employees, leads, clients, assignments, and conversations. Download needed data first.</p><label className="mt-4 block"><span className="text-xs font-black text-red-900">Type {profile?.businessName} to confirm</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-red-300 bg-white px-4 py-3 outline-none focus:border-red-700" /></label><button type="button" disabled={isDeleting || deleteConfirmation.trim().toLowerCase() !== String(profile?.businessName || "").trim().toLowerCase()} onClick={deleteAccount} className="mt-4 w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40 sm:w-auto">{isDeleting ? "Deleting Account…" : "Permanently Delete Account"}</button></section></SectionPanel></>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <style>{`.settings-business-form > div > section:first-child { display: none; } .settings-ai-form > div > section:nth-child(2) { display: none; }`}</style>
      <div className="mx-auto max-w-4xl">
        <header className="mb-4 sm:mb-7">{!setupMode && <Link href="/" className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm"><span aria-hidden="true">←</span>Back to Dashboard</Link>}<p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{setupMode ? "Final account step" : "ARK Client Center"}</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{setupMode ? "Finish Account Setup" : "Settings"}</h1>{!setupMode && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Manage your business, app, billing, and account.</p>}</header>
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {saved && !setupMode && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">Business information saved.</div>}
        {featureNotice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{featureNotice}</div>}
        {downloadNotice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{downloadNotice}</div>}
        {setupMode ? <SectionPanel>{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading setup…</p> : <form onSubmit={saveBusinessInformation}><ReceptionistBusinessForm profile={receptionist} onChange={(next) => setReceptionist(next)} /><button type="submit" disabled={isSaving} className="mt-7 w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isSaving ? "Saving…" : "Save and Open Client Center"}</button></form>}</SectionPanel>
          : isOwner && !activeSection ? <div className="space-y-3 sm:space-y-4">{SETTINGS_BLOCKS.map((block) => <SettingsBlock key={block.key} {...block} onClick={() => setActiveSection(block.key)} />)}</div>
            : isOwner && activeSection === "business" ? businessSection()
              : isOwner && activeSection === "customization" ? customizationSection()
                : isOwner && activeSection === "payment" ? paymentSection()
                  : isOwner && activeSection === "account" ? accountSection()
                    : null}
      </div>
    </main>
  );
}
