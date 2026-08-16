"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import BackButton from "./BackButton";
import ClientDeclineNoticeSettings from "./ClientDeclineNoticeSettings";
import MessageRetentionSettings from "./MessageRetentionSettings";
import { useAuth } from "./AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "./ReceptionistBusinessForm";
import { androidNativeFileSaveAvailable, chooseClientFileDestination, saveClientFile, saveClientFileFromUrl } from "../lib/clientFileSave";
import { db } from "../lib/firebase";
import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_MESSAGE } from "../lib/launchFeatures";
import { ownerFacingError, publicFormError } from "../lib/userFacingError";

const DEFAULT_SETTINGS = { paymentMethodLabel: "", stripeCustomerId: "" };
const THEME_KEY = "ark-theme-v1";
const SETTINGS_BLOCKS = [
  { key: "business", title: "Business Information", description: "Information the AI receptionist uses when answering calls." },
  { key: "customization", title: "Customization", description: "Choose how the app works for your business." },
  { key: "payment", title: "Payment", description: "View usage toward the next $20 charge and manage the payment method." },
  { key: "account", title: "Help & Account", description: "Help, documentation, policies, support, and account deletion." },
];

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}
function paymentDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? "No successful payment recorded yet" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function SettingsBlock({ title, description, onClick, tourId = "" }) {
  return <button type="button" data-tour-id={tourId || undefined} onClick={onClick} className="min-h-24 w-full rounded-2xl border border-slate-300 bg-slate-50 p-4 text-left shadow-sm transition active:scale-[0.99] sm:min-h-28 sm:rounded-3xl sm:px-6 sm:py-5"><h2 className="text-lg font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2><p className="mt-1.5 max-w-2xl text-xs font-semibold leading-5 text-slate-500 sm:text-sm sm:leading-6">{description}</p></button>;
}
function SectionHeader({ title, onBack }) {
  return <div className="mb-4 sm:mb-6"><BackButton onClick={onBack} tourId="settings-section-back" /><h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h2></div>;
}
function SectionPanel({ children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">{children}</section>;
}
function FieldLabel({ children }) {
  return <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{children}</span>;
}
function featureValues(data = {}) {
  return { messagesEnabled: data.messagesEnabled === true };
}
function profileKey(value) { return JSON.stringify(receptionistRequestPayload(value || {})); }

export default function SettingsPanel() {
  const router = useRouter();
  const { user, profile, isAdmin, isOwner, refreshProfile, logout } = useAuth();
  const clientId = profile?.clientId || "";
  const [activeSection, setActiveSection] = useState("");
  const [accountSettings, setAccountSettings] = useState(DEFAULT_SETTINGS);
  const [receptionist, setReceptionist] = useState(null);
  const [savedReceptionist, setSavedReceptionist] = useState(null);
  const [features, setFeatures] = useState(featureValues(profile));
  const [savedFeatures, setSavedFeatures] = useState(null);
  const [featureState, setFeatureState] = useState({ conversationCount: 0, canDisableMessages: true });
  const [usageSummary, setUsageSummary] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [savedDarkMode, setSavedDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
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
    const stiffSettingsMenu = !activeSection;
    if (stiffSettingsMenu) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.classList.toggle("ark-stiff-settings", stiffSettingsMenu);
    return () => document.documentElement.classList.remove("ark-stiff-settings");
  }, [activeSection]);

  useEffect(() => {
    if (!clientId) { setError(ownerFacingError()); setIsLoading(false); return undefined; }
    if (profile?.status === "disabled") {
      setAccountSettings({ ...DEFAULT_SETTINGS, billingPastDue: true, paymentMethodLabel: profile?.paymentMethodLabel || "" });
      return undefined;
    }
    return onSnapshot(doc(db, "accounts", clientId), (snapshot) => setAccountSettings({ ...DEFAULT_SETTINGS, ...(snapshot.exists() ? snapshot.data() : {}) }), (snapshotError) => setError(ownerFacingError(snapshotError)));
  }, [clientId, profile?.paymentMethodLabel, profile?.status]);

  useEffect(() => {
    if (!user || !clientId || isAdmin) { setIsLoading(false); return undefined; }
    if (profile?.status === "disabled") { setIsLoading(false); return undefined; }
    let active = true;
    user.getIdToken(true).then(async (token) => {
      const [receptionistResponse, featureResponse] = await Promise.all([
        fetch("/api/receptionist/settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/account/features", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const receptionistData = await receptionistResponse.json().catch(() => ({}));
      const featureData = await featureResponse.json().catch(() => ({}));
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
          conversationCount: Number(featureData.conversationCount || 0),
          canDisableMessages: featureData.canDisableMessages !== false,
        });
      }
    }).catch((loadError) => active && setError(ownerFacingError(loadError))).finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [clientId, isAdmin, profile?.status, user]);

  const refreshUsageSummary = useCallback(async () => {
    if (!user || isAdmin) return;
    setIsLoadingBilling(true);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/usage-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not refresh the current usage balance.");
      setUsageSummary(data);
      setError("");
    } catch (billingError) {
      setError(ownerFacingError(billingError));
    } finally {
      setIsLoadingBilling(false);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    if (activeSection !== "payment") return undefined;
    refreshUsageSummary();
    const interval = window.setInterval(refreshUsageSummary, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [activeSection, refreshUsageSummary]);

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
    if (!user || !receptionist || isSaving) return true;
    if (!businessDirty) return true;
    setIsSaving(true); setError("");
    try {
      const result = await saveReceptionistProfile();
      setSavedReceptionist(result.prepared);
      await refreshProfile();
      return true;
    } catch (saveError) {
      setError(publicFormError(saveError));
      return false;
    } finally { setIsSaving(false); }
  }
  function updateFeature(key, checked) {
    setError("");
    if (key === "messagesEnabled" && !checked && !featureState.canDisableMessages) {
      setError(`Delete all ${featureState.conversationCount} conversation${featureState.conversationCount === 1 ? "" : "s"} before turning Messages off.`);
      return;
    }
    setFeatures((current) => ({ ...current, [key]: checked }));
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
        conversationCount: Number(data.conversationCount || 0),
        canDisableMessages: data.canDisableMessages !== false,
      });
      try { window.localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light"); } catch {}
      setSavedDarkMode(darkMode);
      await refreshProfile();
      return true;
    } catch (featureError) {
      setError(ownerFacingError(featureError));
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
    } catch (billingError) { setError(ownerFacingError(billingError)); setIsOpeningBilling(false); }
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
    } catch (downloadError) { setError(ownerFacingError(downloadError)); }
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
    } catch (deleteError) { setError(ownerFacingError(deleteError)); setIsDeleting(false); }
  }

  if (isAdmin) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening administrator dashboard…</main>;
  const paymentLabel = accountSettings.paymentMethodLabel || "No payment method label is available yet.";
  const billingStatus = accountSettings.billingPastDue ? "Payment method update needed" : "Current";

  function businessSection() {
    return <><SectionHeader title="Business Information" onBack={backToSettings} /><SectionPanel>{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading business information…</p> : <div className="settings-business-form"><ReceptionistBusinessForm profile={receptionist} onChange={setReceptionist} /></div>}</SectionPanel></>;
  }
  function customizationSection() {
    const messageBlocked = features.messagesEnabled && !featureState.canDisableMessages;
    const controlClass = "flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4";
    return <><SectionHeader title="Customization" onBack={backToSettings} /><SectionPanel><div className="space-y-6">
      <label className={controlClass}><FieldLabel>Dark mode</FieldLabel><input type="checkbox" checked={darkMode} onChange={(event) => updateTheme(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>
      {!MESSAGES_AVAILABLE && <div className="rounded-xl border border-slate-200 bg-slate-100 p-4"><p className="text-sm font-black text-slate-800">Coming soon</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{UPCOMING_FEATURE_MESSAGE}</p></div>}
      {MESSAGES_AVAILABLE && <label className={`${controlClass}${messageBlocked ? " bg-slate-50" : ""}`}><FieldLabel>Messages</FieldLabel><input type="checkbox" disabled={messageBlocked} checked={features.messagesEnabled} onChange={(event) => updateFeature("messagesEnabled", event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>}
      {MESSAGES_AVAILABLE && features.messagesEnabled && <MessageRetentionSettings />}
      {MESSAGES_AVAILABLE && <ClientDeclineNoticeSettings />}
      <div id="account-data" className="border-t border-slate-200 pt-6"><FieldLabel>Client data</FieldLabel><button type="button" onClick={downloadClientData} disabled={isDownloading} className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black disabled:opacity-50 sm:w-auto">{isDownloading ? "Preparing Download…" : "Download Client Data"}</button></div>
    </div></SectionPanel></>;
  }
  function paymentSection() {
    const balanceCents = Number(usageSummary?.usageBalanceCents || 0);
    const thresholdCents = Number(usageSummary?.usageThresholdCents || 2000);
    const progress = Math.max(0, Math.min(100, Number(usageSummary?.usageProgressPercent || 0)));
    const lastPayment = usageSummary?.lastUsagePaymentAt || usageSummary?.lastPaymentAt;
    return <><SectionHeader title="Payment" onBack={backToSettings} /><SectionPanel>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Monthly account</p><p className="mt-1 text-2xl font-black text-slate-950">$50 per month</p></div><button type="button" onClick={refreshUsageSummary} disabled={isLoadingBilling} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">{isLoadingBilling ? "Refreshing…" : "Refresh"}</button></div>
      <div className="mt-6 rounded-2xl bg-gradient-to-br from-slate-950 to-indigo-950 p-5 text-white sm:p-7">
        <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Usage toward next charge</p><p className="mt-2 text-sm font-semibold text-slate-300">Automatically charged whenever usage reaches $20.</p></div><p className="shrink-0 text-2xl font-black">{usageSummary ? `${money(balanceCents)} / ${money(thresholdCents)}` : "—"}</p></div>
        <div className="mt-5 h-4 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Usage toward next twenty dollar charge" aria-valuemin={0} aria-valuemax={20} aria-valuenow={Math.min(20, balanceCents / 100)}><div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black">Receptionist call / new lead</p><p className="mt-1 text-2xl font-black">$2</p><p className="mt-1 text-xs font-bold text-slate-500">A lead saved from the same call counts once.</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black">New chat</p><p className="mt-1 text-2xl font-black">$1</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-black">50 SMS parts</p><p className="mt-1 text-2xl font-black">$1</p><p className="mt-1 text-xs font-bold text-slate-500">{Number(usageSummary?.smsPartRemainder || 0)}/50 toward the next point</p></div></div>
      <div className="mt-4 rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Last successful payment</p><p className="mt-2 text-sm font-bold text-slate-800">{paymentDate(lastPayment)}</p></div>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Payment method</p><p className="mt-2 text-sm font-bold text-slate-800">{paymentLabel}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{billingStatus}</span></div>
      <button type="button" onClick={openBillingPortal} disabled={isOpeningBilling} className="mt-5 w-full rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-indigo-300 sm:w-auto">{isOpeningBilling ? "Opening Stripe…" : "Manage Payment Method"}</button>
    </SectionPanel></>;
  }
  function accountSection() {
    return <><SectionHeader title="Help & Account" onBack={backToSettings} /><SectionPanel><section><h3 className="text-lg font-black">Help and Resources</h3><div className="mt-4 grid gap-2 sm:grid-cols-2"><Link href="/help" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Open Help</Link><Link href="/docs" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Documentation</Link><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link></div></section><section className="mt-7 border-t border-red-200 pt-7"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-700">Danger zone</p><h3 className="mt-1 text-lg font-black text-red-950">Delete Account</h3><p className="mt-2 text-xs leading-5 text-red-800 sm:text-sm">This cancels the subscription and permanently deletes the owner account, leads, clients, and conversations. Download needed data first.</p><label className="mt-4 block"><span className="text-xs font-black text-red-900">Type {profile?.businessName} to confirm</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-red-300 bg-white px-4 py-3 outline-none focus:border-red-700" /></label><button type="button" disabled={isDeleting || deleteConfirmation.trim().toLowerCase() !== String(profile?.businessName || "").trim().toLowerCase()} onClick={deleteAccount} className="mt-4 w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40 sm:w-auto">{isDeleting ? "Deleting Account…" : "Permanently Delete Account"}</button></section></SectionPanel></>;
  }

  return (
    <main className="ark-settings-page min-h-screen bg-transparent px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-4xl">
        {!activeSection && <header className="mb-4 sm:mb-7"><BackButton href="/" className="mb-4" tourId="settings-menu-back" /><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1></header>}
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {downloadNotice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{downloadNotice}</div>}
        {isOwner && !activeSection ? <div className="rounded-[2rem] border border-slate-300 bg-slate-300/70 p-3 shadow-inner sm:p-5"><div className="space-y-3 sm:space-y-4">{SETTINGS_BLOCKS.map((block) => <SettingsBlock key={block.key} {...block} tourId={`settings-${block.key}`} onClick={() => setActiveSection(block.key)} />)}</div></div>
            : isOwner && activeSection === "business" ? businessSection()
              : isOwner && activeSection === "customization" ? customizationSection()
                : isOwner && activeSection === "payment" ? paymentSection()
                  : isOwner && activeSection === "account" ? accountSection()
                    : null}
      </div>
    </main>
  );
}
