"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BackButton from "./BackButton";
import ClientDeclineNoticeSettings from "./ClientDeclineNoticeSettings";
import HelpCenter from "./HelpCenter";
import InfoTip from "./InfoTip";
import MessageRetentionSettings from "./MessageRetentionSettings";
import PaymentManagementPanel from "./PaymentManagementPanel";
import { formatUsd } from "./SubscriptionPlanCard";
import { useAuth } from "./AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "./ReceptionistBusinessForm";
import { androidNativeFileSaveAvailable, chooseClientFileDestination, saveClientFile, saveClientFileFromUrl } from "../lib/clientFileSave";
import { MESSAGES_AVAILABLE } from "../lib/launchFeatures";
import { ownerFacingError, publicFormError } from "../lib/userFacingError";
import { appleIapAvailable } from "../lib/appleIapClient";
import { TEMPORARY_FEATURES } from "../lib/temporaryFeatures";
import { formatNotificationPhone, NOTIFICATION_SMS_FROM_DISPLAY } from "../lib/notificationPreferences";

const DEFAULT_SETTINGS = { billingProvider: "stripe", paymentMethodLabel: "", stripeCustomerId: "" };
const BUSINESS_AUTO_SAVE_DELAY_MS = 650;
const ACCOUNT_RESOURCE_CLASS = "min-h-20 rounded-2xl border border-slate-300 bg-white p-5 text-left shadow-sm transition active:scale-[0.99]";
const SETTINGS_BLOCKS = [
  { key: "business", title: "Business information" },
  { key: "customization", title: "App" },
  { key: "payment", title: "Plan and payment" },
  { key: "account", title: "Help & Account" },
];

function SettingsBlock({ title, onClick }) {
  return <button type="button" onClick={onClick} className="min-h-20 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] sm:min-h-24 sm:rounded-3xl sm:px-6 sm:py-5"><h2 className="text-lg font-black tracking-tight text-slate-950 sm:text-2xl">{title}</h2></button>;
}
function SectionHeader({ title, onBack }) {
  return <div className="mb-4 sm:mb-6"><BackButton onClick={onBack} /><h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h2></div>;
}
function SectionPanel({ children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">{children}</section>;
}
function ToggleRow({ id, title, detail, checked, disabled = false, onChange }) {
  return <label htmlFor={id} className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 ${disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : "bg-white"}`}>
    <span className="min-w-0"><span className="block text-sm font-black text-slate-950">{title}</span>{detail && <span className="mt-1 block break-words text-xs font-semibold text-slate-600">{detail}</span>}</span>
    <input id={id} type="checkbox" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-blue-800" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} /></span>
  </label>;
}
function AccountResourceLink({ href, title }) {
  return <Link href={href} className={ACCOUNT_RESOURCE_CLASS}><p className="text-lg font-black text-slate-950">{title}</p></Link>;
}
function featureValues(data = {}) {
  const notificationChannels = Array.isArray(data.notificationChannels)
    ? ["email", "sms"].filter((channel) => data.notificationChannels.includes(channel))
    : [];
  return {
    messagesEnabled: data.messagesEnabled === true,
    notificationChannels,
    notificationEmail: String(data.notificationEmail || data.accountEmail || "").trim().toLowerCase(),
    notificationPhone: String(data.notificationPhone || data.accountPhone || "").trim(),
    notificationPreferencesCompleted: data.notificationPreferencesCompleted === true,
  };
}
function profileKey(value) { return JSON.stringify(receptionistRequestPayload(value || {})); }
function customizationKey(features, darkMode) { return JSON.stringify({ ...featureValues(features), darkMode: darkMode === true }); }

export default function SettingsPanel() {
  const router = useRouter();
  const { user, profile, isOwner, updateProfile, logout } = useAuth();
  const clientId = profile?.clientId || "";
  const [activeSection, setActiveSection] = useState("");
  const [paymentManagerOpen, setPaymentManagerOpen] = useState(false);
  const [paymentManagerPanel, setPaymentManagerPanel] = useState("");
  const [nativeIos, setNativeIos] = useState(false);
  const [accountSettings, setAccountSettings] = useState(DEFAULT_SETTINGS);
  const [receptionist, setReceptionist] = useState(null);
  const [savedReceptionist, setSavedReceptionist] = useState(null);
  const [features, setFeatures] = useState(featureValues(profile));
  const [featureState, setFeatureState] = useState({ conversationCount: 0, canDisableMessages: true });
  const [planSummary, setPlanSummary] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [error, setError] = useState("");
  const receptionistRef = useRef(null);
  const savedReceptionistRef = useRef(null);
  const featuresRef = useRef(featureValues(profile));
  const savedFeaturesRef = useRef(featureValues(profile));
  const darkModeRef = useRef(profile?.darkMode === true);
  const savedDarkModeRef = useRef(profile?.darkMode === true);
  const businessSaveQueueRef = useRef(Promise.resolve(true));
  const businessAutosaveTimerRef = useRef(null);
  const customizationSaveQueueRef = useRef(Promise.resolve(true));

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedSection = parameters.get("section");
    if (SETTINGS_BLOCKS.some((block) => block.key === requestedSection)) setActiveSection(requestedSection);
    const requestedManager = parameters.get("manage");
    if (requestedSection === "payment" && ["plan", "topup", "card"].includes(requestedManager)) {
      setPaymentManagerPanel(requestedManager);
      setPaymentManagerOpen(true);
    }
    setNativeIos(appleIapAvailable());
  }, []);

  useEffect(() => {
    const enabled = profile?.darkMode === true;
    darkModeRef.current = enabled;
    savedDarkModeRef.current = enabled;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("ark-dark", enabled);
  }, [profile?.darkMode]);

  useEffect(() => {
    const stiffSettingsMenu = !activeSection;
    if (stiffSettingsMenu) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.classList.toggle("ark-stiff-settings", stiffSettingsMenu);
    return () => document.documentElement.classList.remove("ark-stiff-settings");
  }, [activeSection]);

  useEffect(() => {
    if (!clientId) { setError(ownerFacingError()); setIsLoading(false); return undefined; }
    setAccountSettings({
      ...DEFAULT_SETTINGS,
      billingProvider: profile?.billingProvider || "stripe",
      billingPastDue: profile?.billingPastDue === true,
      paymentMethodLabel: profile?.paymentMethodLabel || "",
    });
    return undefined;
  }, [clientId, profile?.billingPastDue, profile?.billingProvider, profile?.paymentMethodLabel]);

  useEffect(() => {
    if (!user || !clientId) { setIsLoading(false); return undefined; }
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
        receptionistRef.current = prepared;
        savedReceptionistRef.current = prepared;
        setReceptionist(prepared);
        setSavedReceptionist(prepared);
        featuresRef.current = nextFeatures;
        savedFeaturesRef.current = nextFeatures;
        setFeatures(nextFeatures);
        const nextDarkMode = featureData.darkMode === true;
        darkModeRef.current = nextDarkMode;
        savedDarkModeRef.current = nextDarkMode;
        setDarkMode(nextDarkMode);
        document.documentElement.classList.toggle("ark-dark", nextDarkMode);
        setFeatureState({
          conversationCount: Number(featureData.conversationCount || 0),
          canDisableMessages: featureData.canDisableMessages !== false,
        });
      }
    }).catch((loadError) => active && setError(ownerFacingError(loadError))).finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [clientId, profile?.status, user]);

  const refreshPlanSummary = useCallback(async () => {
    if (!user) return;
    setIsLoadingBilling(true);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/plan-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not refresh the current accepted-lead plan.");
      setPlanSummary(data);
      setError("");
    } catch (billingError) {
      setError(ownerFacingError(billingError));
    } finally {
      setIsLoadingBilling(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeSection !== "payment") return undefined;
    refreshPlanSummary();
    const interval = window.setInterval(refreshPlanSummary, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [activeSection, refreshPlanSummary]);

  const businessDirty = useMemo(() => Boolean(receptionist && savedReceptionist && profileKey(receptionist) !== profileKey(savedReceptionist)), [receptionist, savedReceptionist]);

  const persistBusinessSnapshot = useCallback(async (snapshot) => {
    if (!user || !snapshot) return false;
    const snapshotKey = profileKey(snapshot);
    const token = await user.getIdToken(true);
    const response = await fetch("/api/receptionist/settings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(receptionistRequestPayload(snapshot)) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save business information.");
    const prepared = prepareReceptionistProfile(data.profile);
    savedReceptionistRef.current = prepared;
    setSavedReceptionist(prepared);
    if (profileKey(receptionistRef.current) === snapshotKey) {
      receptionistRef.current = prepared;
      setReceptionist(prepared);
    }
    updateProfile({
      businessName: prepared.businessName,
      ownerName: prepared.ownerName,
      businessEmail: prepared.businessEmail,
      businessPhone: prepared.businessPhone,
    });
    return true;
  }, [updateProfile, user]);

  const queueBusinessSave = useCallback((snapshot) => {
    if (!user || !snapshot) return Promise.resolve(false);
    const snapshotKey = profileKey(snapshot);
    const run = async () => {
      if (snapshotKey === profileKey(savedReceptionistRef.current)) return true;
      setError("");
      try {
        await persistBusinessSnapshot(snapshot);
        return true;
      } catch (saveError) {
        setError(publicFormError(saveError, "Could not save business information."));
        return false;
      }
    };
    const queued = businessSaveQueueRef.current.then(run, run);
    businessSaveQueueRef.current = queued.then(() => true, () => true);
    return queued;
  }, [persistBusinessSnapshot, user]);

  function changeReceptionist(next, options = {}) {
    receptionistRef.current = next;
    setReceptionist(next);
    setError("");
    if (options.saveImmediately) {
      window.clearTimeout(businessAutosaveTimerRef.current);
      queueBusinessSave(next);
    }
  }

  useEffect(() => {
    if (activeSection !== "business" || !businessDirty || !receptionist) return undefined;
    window.clearTimeout(businessAutosaveTimerRef.current);
    businessAutosaveTimerRef.current = window.setTimeout(() => queueBusinessSave(receptionist), BUSINESS_AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(businessAutosaveTimerRef.current);
  }, [activeSection, businessDirty, queueBusinessSave, receptionist]);

  async function saveBusinessInformation() {
    window.clearTimeout(businessAutosaveTimerRef.current);
    const latest = receptionistRef.current;
    if (!latest || profileKey(latest) === profileKey(savedReceptionistRef.current)) return true;
    const saved = await queueBusinessSave(latest);
    return saved && profileKey(latest) === profileKey(savedReceptionistRef.current);
  }

  const persistCustomizationSnapshot = useCallback(async (snapshot) => {
    if (!user) return false;
    const snapshotKey = customizationKey(snapshot.features, snapshot.darkMode);
    const token = await user.getIdToken(true);
    const response = await fetch("/api/account/features", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...snapshot.features, darkMode: snapshot.darkMode }),
      keepalive: true,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not update account features.");

    const nextFeatures = featureValues(data);
    const nextDarkMode = data.darkMode === true;
    savedFeaturesRef.current = nextFeatures;
    savedDarkModeRef.current = nextDarkMode;

    if (customizationKey(featuresRef.current, darkModeRef.current) === snapshotKey) {
      featuresRef.current = nextFeatures;
      darkModeRef.current = nextDarkMode;
      setFeatures(nextFeatures);
      setDarkMode(nextDarkMode);
      document.documentElement.classList.toggle("ark-dark", nextDarkMode);
      updateProfile({ ...nextFeatures, darkMode: nextDarkMode });
    }

    setFeatureState({
      conversationCount: Number(data.conversationCount || 0),
      canDisableMessages: data.canDisableMessages !== false,
    });
    return true;
  }, [updateProfile, user]);

  const queueCustomizationSave = useCallback((snapshot) => {
    if (!user) return Promise.resolve(false);
    const snapshotKey = customizationKey(snapshot.features, snapshot.darkMode);
    const run = async () => {
      if (snapshotKey === customizationKey(savedFeaturesRef.current, savedDarkModeRef.current)) return true;
      setError("");
      try {
        return await persistCustomizationSnapshot(snapshot);
      } catch (saveError) {
        setError(ownerFacingError(saveError));
        return false;
      }
    };
    const queued = customizationSaveQueueRef.current.then(run, run);
    customizationSaveQueueRef.current = queued.then(() => true, () => true);
    return queued;
  }, [persistCustomizationSnapshot, user]);

  function updateFeature(key, checked) {
    setError("");
    if (key === "messagesEnabled" && !checked && !featureState.canDisableMessages) {
      setError(`Delete all ${featureState.conversationCount} conversation${featureState.conversationCount === 1 ? "" : "s"} before turning Messages off.`);
      return;
    }
    const nextFeatures = { ...featuresRef.current, [key]: checked };
    featuresRef.current = nextFeatures;
    setFeatures(nextFeatures);
    queueCustomizationSave({ features: nextFeatures, darkMode: darkModeRef.current });
  }
  function updateTheme(checked) {
    darkModeRef.current = checked;
    setDarkMode(checked);
    document.documentElement.classList.toggle("ark-dark", checked);
    queueCustomizationSave({ features: featuresRef.current, darkMode: checked });
  }
  function updateNotificationChannel(channel, checked) {
    setError("");
    const selected = new Set(featuresRef.current.notificationChannels || []);
    if (checked) selected.add(channel);
    else selected.delete(channel);
    if (!selected.size) {
      setError("Keep at least one notification method selected.");
      return;
    }
    const nextFeatures = {
      ...featuresRef.current,
      notificationChannels: ["email", "sms"].filter((item) => selected.has(item)),
      notificationPreferencesCompleted: true,
    };
    featuresRef.current = nextFeatures;
    setFeatures(nextFeatures);
    queueCustomizationSave({ features: nextFeatures, darkMode: darkModeRef.current });
  }
  async function saveCustomization() {
    if (!user) return true;
    setError("");
    if (businessDirty && !await saveBusinessInformation()) return false;
    const latest = { features: featuresRef.current, darkMode: darkModeRef.current };
    if (customizationKey(latest.features, latest.darkMode) === customizationKey(savedFeaturesRef.current, savedDarkModeRef.current)) return true;
    return queueCustomizationSave(latest);
  }
  async function backToSettings() {
    const saved = activeSection === "business" ? await saveBusinessInformation() : activeSection === "customization" ? await saveCustomization() : true;
    if (saved !== false) setActiveSection("");
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

  const billingProvider = planSummary?.billingProvider || profile?.billingProvider || accountSettings.billingProvider;
  const appleBilling = billingProvider === "apple";
  const paymentLabel = planSummary?.paymentMethodLabel || accountSettings.paymentMethodLabel || (appleBilling ? "Apple Account" : "No payment method label is available yet.");
  const billingStatus = accountSettings.billingPastDue ? "Payment method update needed" : "Current";

  function openPaymentManager(panel = "plan") {
    const requestedPanel = ["plan", "topup", "card"].includes(panel) ? panel : "plan";
    setPaymentManagerPanel(requestedPanel);
    setPaymentManagerOpen(true);
    router.replace(`/settings?section=payment&manage=${encodeURIComponent(requestedPanel)}`, { scroll: false });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  function closePaymentManager() {
    setPaymentManagerOpen(false);
    setPaymentManagerPanel("");
    router.replace("/settings?section=payment", { scroll: false });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  function businessSection() {
    return <><SectionHeader title="Business information" onBack={backToSettings} /><SectionPanel>{isLoading || !receptionist ? <p className="rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading business information…</p> : <div className="settings-business-form"><ReceptionistBusinessForm profile={receptionist} onChange={changeReceptionist} /></div>}</SectionPanel></>;
  }
  function customizationSection() {
    const messageBlocked = features.messagesEnabled && !featureState.canDisableMessages;
    return <><SectionHeader title="App" onBack={backToSettings} /><div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-4 text-base font-black text-slate-950">Appearance</h3>
        <ToggleRow id="dark-mode" title="Dark mode" checked={darkMode} onChange={updateTheme} />
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-2"><h3 className="text-base font-black text-slate-950">Alerts</h3><InfoTip label="About alerts">New leads and important account updates. Keep email, text, or both turned on.</InfoTip></div>
        <div className="mt-4 space-y-3">
          <ToggleRow id="email-alerts" title="Email" detail={features.notificationEmail || profile?.accountEmail} checked={features.notificationChannels.includes("email")} onChange={(checked) => updateNotificationChannel("email", checked)} />
          <ToggleRow id="text-alerts" title="Text message" detail={formatNotificationPhone(features.notificationPhone || profile?.accountPhone)} checked={features.notificationChannels.includes("sms")} onChange={(checked) => updateNotificationChannel("sms", checked)} />
        </div>
        {features.notificationChannels.includes("sms") && <p className="mt-3 text-[11px] font-semibold leading-5 text-slate-500">Sent from {NOTIFICATION_SMS_FROM_DISPLAY}. Message and data rates may apply. Reply STOP to opt out.</p>}
      </section>
      {MESSAGES_AVAILABLE && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h3 className="mb-4 text-base font-black text-slate-950">Messages</h3><ToggleRow id="messages-enabled" title="Customer messages" checked={features.messagesEnabled} disabled={messageBlocked} onChange={(checked) => updateFeature("messagesEnabled", checked)} /></section>}
      <MessageRetentionSettings showMessages={MESSAGES_AVAILABLE && features.messagesEnabled} />
      <ClientDeclineNoticeSettings />
      <section id="account-data" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h3 className="text-base font-black text-slate-950">Your data</h3><button type="button" onClick={downloadClientData} disabled={isDownloading} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black disabled:opacity-50 sm:w-auto">{isDownloading ? "Preparing…" : "Download data"}</button></section>
    </div></>;
  }
  function paymentSection() {
    if (paymentManagerOpen) {
      return <><SectionHeader title="Plan and payment" onBack={closePaymentManager} /><PaymentManagementPanel
        user={user}
        planSummary={planSummary}
        billingProvider={billingProvider}
        nativeIos={nativeIos}
        initialPanel={paymentManagerPanel}
        onChanged={refreshPlanSummary}
        onPaymentMethodChanged={(label) => {
          setAccountSettings((current) => ({ ...current, paymentMethodLabel: label }));
          setPlanSummary((current) => current ? { ...current, paymentMethodLabel: label } : current);
        }}
        onClose={closePaymentManager}
      /></>;
    }
    const acceptedLeadsRemaining = Math.max(0, Number(planSummary?.acceptedLeadsRemaining || 0));
    const monthlyAcceptedLeadLimit = Math.max(1, Number(planSummary?.monthlyAcceptedLeadLimit || 25));
    const acceptedLeadPeriodLimit = Math.max(monthlyAcceptedLeadLimit, Number(planSummary?.acceptedLeadPeriodLimit || monthlyAcceptedLeadLimit));
    return <><SectionHeader title="Plan and payment" onBack={backToSettings} /><SectionPanel>
      <div className="rounded-2xl bg-blue-900 p-5 text-white sm:p-7">
        <div className="flex items-center gap-2"><p className="text-sm font-black text-blue-100">Leads left</p><InfoTip label="About leads left">One request counts when you tap Accept. Calls and declined requests do not count.</InfoTip></div>
        <p className="mt-2 text-5xl font-black">{planSummary ? acceptedLeadsRemaining : "—"}<span className="ml-2 text-base text-blue-100">of {acceptedLeadPeriodLimit}</span></p>
        <p className="mt-3 text-xs font-bold text-blue-100">Resets {planSummary?.periodEndAt ? new Date(planSummary.periodEndAt).toLocaleDateString() : "each billing month"}{isLoadingBilling ? " · Updating…" : ""}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black text-slate-500">Plan</p><p className="mt-1 text-xl font-black text-slate-950">{planSummary?.planName || "Starter"}</p><p className="mt-1 text-sm font-bold text-slate-600">{formatUsd(planSummary?.monthlyPriceCents || 2499)}/month</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black text-slate-500">Payment</p><p className="mt-1 text-sm font-black text-slate-950">{paymentLabel}</p><p className="mt-1 text-xs font-bold text-slate-600">{billingStatus}</p></div>
      </div>
      {planSummary?.pendingBillingPlanKey && <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-900">{planSummary.pendingBillingPlanName} Plan starts {planSummary.pendingBillingPlanStartsAt ? new Date(planSummary.pendingBillingPlanStartsAt).toLocaleDateString() : "after payment is confirmed"}.</p>}
      <button type="button" onClick={() => openPaymentManager("plan")} className="mt-4 w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-black text-white sm:w-auto">Manage</button>
    </SectionPanel></>;
  }
  function accountSection() {
    const deletedRecords = MESSAGES_AVAILABLE ? "leads, clients, and conversations" : "leads and clients";
    return <><SectionHeader title="Help & Account" onBack={backToSettings} /><SectionPanel><section><h3 className="text-lg font-black">Help and resources</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><AccountResourceLink href="/docs" title="Docs" description="App guide" /><HelpCenter className={ACCOUNT_RESOURCE_CLASS} />{TEMPORARY_FEATURES.feedback.enabled && <AccountResourceLink href="/feedback" title="Give feedback" description="Share an idea or problem" />}<AccountResourceLink href="/messages" title="Support" description="Account or technical help" /><AccountResourceLink href="/terms" title="Terms of Use" description="Service agreement" /><AccountResourceLink href="/privacy" title="Privacy Policy" description="How ARK handles data" /></div></section><section className="mt-7 border-t border-red-200 pt-7"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-700">Danger zone</p><h3 className="mt-1 text-lg font-black text-red-950">Delete account</h3><p className="mt-2 text-xs leading-5 text-red-800 sm:text-sm">{appleBilling ? `Cancel with Apple first. This permanently deletes the account, ${deletedRecords}.` : `This cancels the subscription and permanently deletes the account, ${deletedRecords}.`} Download anything you need first.</p><label className="mt-4 block"><span className="text-xs font-black text-red-900">Type {profile?.businessName} to confirm</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-red-300 bg-white px-4 py-3 outline-none focus:border-red-700" /></label><button type="button" disabled={isDeleting || deleteConfirmation.trim().toLowerCase() !== String(profile?.businessName || "").trim().toLowerCase()} onClick={deleteAccount} className="mt-4 w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40 sm:w-auto">{isDeleting ? "Deleting…" : "Delete account"}</button></section></SectionPanel></>;
  }

  return (
    <main className="ark-settings-page min-h-screen bg-transparent px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-4xl">
        {!activeSection && <header className="mb-4 sm:mb-7"><BackButton href="/" className="mb-4" /><h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Settings</h1></header>}
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {downloadNotice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{downloadNotice}</div>}
        {isOwner && !activeSection ? <div className="rounded-3xl border border-slate-200 bg-slate-200/60 p-3 sm:p-5"><div className="space-y-3 sm:space-y-4">{SETTINGS_BLOCKS.map((block) => <SettingsBlock key={block.key} {...block} onClick={() => setActiveSection(block.key)} />)}</div></div>
            : isOwner && activeSection === "business" ? businessSection()
              : isOwner && activeSection === "customization" ? customizationSection()
                : isOwner && activeSection === "payment" ? paymentSection()
                  : isOwner && activeSection === "account" ? accountSection()
                    : null}
      </div>
    </main>
  );
}
