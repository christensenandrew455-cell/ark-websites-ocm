"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import BackButton from "./BackButton";
import EmployeeAccessSettings from "./EmployeeAccessSettings";
import MessageRetentionSettings from "./MessageRetentionSettings";
import { useAuth } from "./AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "./ReceptionistBusinessForm";
import { androidNativeFileSaveAvailable, chooseClientFileDestination, saveClientFile, saveClientFileFromUrl } from "../lib/clientFileSave";
import { db } from "../lib/firebase";

const DEFAULT_SETTINGS = { BillingStatus: "", PaymentMethodLabel: "", StripeCustomerId: "" };
const THEME_KEY = "ark-theme-v1";
const SETTINGS_BLOCKS = [
  { key: "business", title: "Business Information", description: "Information the AI receptionist uses when answering calls." },
  { key: "customization", title: "Customization", description: "Choose how the app works for your business." },
  { key: "payment", title: "Payment", description: "View the estimated monthly total and manage the payment method." },
  { key: "account", title: "Help & Account", description: "Help, documentation, policies, support, and account deletion." },
];

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}
function SettingsBlock({ title, description, onClick }) {
  return <button type="button" onClick={onClick} className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition active:scale-[0.99] sm:min-h-32 sm:rounded-3xl sm:p-7"><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2><p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">{description}</p></button>;
}
function SectionHeader({ title, onBack }) {
  return <div className="mb-4 sm:mb-6"><BackButton onClick={onBack} /><h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h2></div>;
}
function SectionPanel({ children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">{children}</section>;
}
function featureValues(data = {}) {
  return { messagesEnabled: data.messagesEnabled === true, employeesEnabled: data.employeesEnabled === true, employeeMessagingEnabled: data.employeeMessagingEnabled === true };
}
function profileKey(value) { return JSON.stringify(receptionistRequestPayload(value || {})); }

export default function SettingsPanel({ setupMode = false }) {
  const router = useRouter();
  const { user, profile, isAdmin, isOwner, refreshProfile, logout } = useAuth();
  const clientId = profile?.clientId || "";
  const [activeSection, setActiveSection] = useState("");
  const [accountSettings, setAccountSettings] = useState(DEFAULT_SETTINGS);
  const [receptionist, setReceptionist] = useState(null);
  const [savedReceptionist, setSavedReceptionist] = useState(null);
  const [features, setFeatures] = useState(featureValues(profile));
  const [savedFeatures, setSavedFeatures] = useState(null);
  const [featureState, setFeatureState] = useState({ employeeCount: 0, conversationCount: 0, canDisableEmployees: true, canDisableMessages: true });
  const [billingSummary, setBillingSummary] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [savedDarkMode, setSavedDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const enabled = window.localStorage.getItem(THEME_KEY) === "dark";
      setDarkMode(enabled);
      setSavedDarkMode(enabled);
      document.documentElement.classList.toggle("ark-dark", enabled);
    } catch {
      setDarkMode(false);
      setSavedDarkMode(false);
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
        const prepared = prepareReceptionistProfile(receptionistData.profile);
        const nextFeatures = featureValues(featureData);
        setReceptionist(prepared);
        setSavedReceptionist(prepared);
        setFeatures(nextFeatures);
        setSavedFeatures(nextFeatures);
        setFeatureState({
          employeeCount: Number(featureData.employeeCount || 0),
          conversationCount: Number(featureData.conversationCount || 0),
          canDisableEmployees: featureData.canDisableEmployees !== false,
          canDisableMessages: featureData.canDisableMessages !== false,
        });
        if (billingResponse.ok) setBillingSummary(billingData);
      }
    }).catch((loadError) => active && setError(loadError.message)).finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [clientId, isAdmin, user]);

  const businessDirty = useMemo(() => Boolean(receptionist && savedReceptionist && profileKey(receptionist) !== profileKey(savedReceptionist)), [receptionist, savedReceptionist]);
  const customizationDirty = useMemo(() => businessDirty || Boolean(savedFeatures && JSON.stringify(features) !== JSON.stringify(savedFeatures)) || darkMode !== savedDarkMode, [businessDirty, darkMode, features, savedDarkMode, savedFeatures]);

  async function saveReceptionistProfile() {
    const token = await user.getIdToken(true);
    const response = await fetch("/api/receptionist/settings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(receptionistRequestPayload(receptionist)) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save AI receptionist information.");
    const prepared = prepareReceptionistProfile(data.profile);
    setReceptionist(prepared);
    return { token, prepared };
  }
  async function saveBusinessInformation() {
    if (!user || !receptionist || isSaving || !businessDirty) return true;
    setIsSaving(true); setError("");
    try {
      const result = await saveReceptionistProfile();
      setSavedReceptionist(result.prepared);
      await refreshProfile();
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    } finally { setIsSaving(false); }
  }
  function updateFeature(key, checked) {
    setError("");
    if (key === "employeesEnabled" && !checked && !featureState.canDisableEmployees) {
      setError(`Delete all ${featureState.employeeCount} employee account${featureState.employeeCount === 1 ? "" : "s"} before turning Employees off.`);
      return;
    }
    if (key === "messagesEnabled" && !checked && !featureState.canDisableMessages) {
      setError(`Delete all ${featureState.conversationCount} conversation${featureState.conversationCount === 1 ? "" : "s"} before turning Messages off.`);
      return;
    }
    setFeatures((current) => {
      const next = { ...current, [key]: checked };
      if (!next.messagesEnabled || !next.employeesEnabled) next.employeeMessagingEnabled = false;
      return next;
    });
  }
  function updateTheme(checked) {
    setDarkMode(checked);
    document.documentElement.classList.toggle("ark-dark", checked);
  }
  async function saveCustomization() {
    if (!user || !receptionist || isSavingCustomization || !customizationDirty) return true;
    setIsSavingCustomization(true); setError("");
    try {
      const result = await saveReceptionistProfile();
      const response = await fetch("/api/account/features", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${result.token}` }, body: JSON.stringify(features) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update account features.");
      const nextFeatures = featureValues(data);
      setFeatures(nextFeatures);
      setSavedFeatures(nextFeatures);
      setSavedReceptionist(result.prepared);
      setFeatureState({
        employeeCount: Number(data.employeeCount || 0),
        conversationCount: Number(data.conversationCount || 0),
        canDisableEmployees: data.canDisableEmployees !== false,
        canDisableMessages: data.canDisableMessages !== false,
      });
      try { window.localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light"); } catch {}
      setSavedDarkMode(darkMode);
      await refreshProfile();
      return true;
    } catch (featureError) {
      setError(featureError.message);
      return false;
    } finally { setIsSavingCustomization(false); }
  }
  async function backToSettings() {
    const saved = activeSection === "business" ? await saveBusinessInformation() : activeSection === "customization" ? await saveCustomization() : true;
    if (saved !== false) setActiveSection("");
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
    return <><SectionHeader title="Business Information" onBack={backToSettings} /><SectionPanel>{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading business information…</p> : <div className="settings-business-form"><ReceptionistBusinessForm profile={receptionist} onChange={setReceptionist} /></div>}</SectionPanel></>;
  }
  function customizationSection() {
    const messageBlocked = features.messagesEnabled && !featureState.canDisableMessages;
    const employeeBlocked = features.employeesEnabled && !featureState.canDisableEmployees;
    return <><SectionHeader title="Customization" onBack={backToSettings} /><SectionPanel><div className="space-y-7">
      <section><h3 className="text-lg font-black">Appearance</h3><label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span className="text-sm font-black">Dark Mode</span><input type="checkbox" checked={darkMode} onChange={(event) => updateTheme(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label></section>
      <section><h3 className="text-lg font-black">App Tools</h3><div className="mt-4 space-y-3"><label className={messageBlocked ? "flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" : "flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"}><span><strong className="block text-sm">Messages</strong><span className="text-xs text-slate-500">$1 per 50 inbound and outbound SMS parts.</span></span><input type="checkbox" disabled={messageBlocked} checked={features.messagesEnabled} onChange={(event) => updateFeature("messagesEnabled", event.target.checked)} className="h-5 w-5 accent-slate-950" /></label><label className={employeeBlocked ? "flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" : "flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"}><span><strong className="block text-sm">Employees</strong><span className="text-xs text-slate-500">Employee accounts, assignments, and access controls.</span></span><input type="checkbox" disabled={employeeBlocked} checked={features.employeesEnabled} onChange={(event) => updateFeature("employeesEnabled", event.target.checked)} className="h-5 w-5 accent-slate-950" /></label></div></section>
      {features.messagesEnabled && <MessageRetentionSettings />}
      {features.employeesEnabled && <EmployeeAccessSettings embedded />}
      <section><h3 className="text-lg font-black">AI Receptionist</h3><div className="settings-ai-form mt-4">{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading AI settings…</p> : <ReceptionistBusinessForm profile={receptionist} onChange={setReceptionist} />}</div></section>
      <section id="account-data" className="border-t border-slate-200 pt-7"><h3 className="text-lg font-black">Client Data</h3><button type="button" onClick={downloadClientData} disabled={isDownloading} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black disabled:opacity-50 sm:w-auto">{isDownloading ? "Preparing Download…" : "Download Client Data"}</button></section>
    </div></SectionPanel></>;
  }
  function paymentSection() {
    return <><SectionHeader title="Payment" onBack={backToSettings} /><SectionPanel><div className="rounded-2xl bg-slate-50 p-5 sm:p-7"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Estimated total cost this month</p><p className="mt-2 text-right text-4xl font-black tracking-tight sm:text-6xl">{money(billingSummary?.amountDue || 0)}</p></div><div className="mt-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Payment method</p><p className="mt-2 text-sm font-bold text-slate-800">{paymentLabel}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{billingStatus}</span></div><button type="button" onClick={openBillingPortal} disabled={isOpeningBilling} className="mt-5 w-full rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-indigo-300 sm:w-auto">{isOpeningBilling ? "Opening Stripe…" : "Manage Payment Method"}</button></SectionPanel></>;
  }
  function accountSection() {
    return <><SectionHeader title="Help & Account" onBack={backToSettings} /><SectionPanel><section><h3 className="text-lg font-black">Help and Resources</h3><div className="mt-4 grid gap-2 sm:grid-cols-2"><Link href="/help" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Open Help</Link><Link href="/docs" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Documentation</Link><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link></div></section><section className="mt-7 border-t border-red-200 pt-7"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-700">Danger zone</p><h3 className="mt-1 text-lg font-black text-red-950">Delete Account</h3><p className="mt-2 text-xs leading-5 text-red-800 sm:text-sm">This cancels the subscription and permanently deletes the owner account, employees, leads, clients, assignments, and conversations. Download needed data first.</p><label className="mt-4 block"><span className="text-xs font-black text-red-900">Type {profile?.businessName} to confirm</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-red-300 bg-white px-4 py-3 outline-none focus:border-red-700" /></label><button type="button" disabled={isDeleting || deleteConfirmation.trim().toLowerCase() !== String(profile?.businessName || "").trim().toLowerCase()} onClick={deleteAccount} className="mt-4 w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40 sm:w-auto">{isDeleting ? "Deleting Account…" : "Permanently Delete Account"}</button></section></SectionPanel></>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <style>{`.settings-business-form > div > section:first-child { display: none; } .settings-ai-form > div > section:nth-child(2) { display: none; }`}</style>
      <div className="mx-auto max-w-4xl">
        {(setupMode || !activeSection) && <header className="mb-4 sm:mb-7">{!setupMode && <BackButton href="/" className="mb-4" />}{setupMode && <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Final account step</p>}<h1 className="text-3xl font-black tracking-tight sm:text-4xl">{setupMode ? "Finish Account Setup" : "Settings"}</h1></header>}
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {downloadNotice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{downloadNotice}</div>}
        {setupMode ? <SectionPanel>{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading setup…</p> : <form onSubmit={async (event) => { event.preventDefault(); if (await saveBusinessInformation()) router.replace("/"); }}><ReceptionistBusinessForm profile={receptionist} onChange={setReceptionist} /><button type="submit" disabled={isSaving} className="mt-7 w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isSaving ? "Saving…" : "Save and Open Client Center"}</button></form>}</SectionPanel>
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
