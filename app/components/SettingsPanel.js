"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const TIME_OPTIONS = Array.from({ length: 25 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const labelHour = hour % 12 || 12;
  return `${labelHour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
});

const DEFAULT_SETTINGS = {
  BusinessName: "",
  OwnerName: "",
  AccountEmail: "",
  AccountPhone: "",
  BillingStatus: "",
  PaymentMethodLabel: "",
  StripeCustomerId: "",
};

function Field({ label, hint = "", children, wide = false }) {
  return (
    <label className={wide ? "min-w-0 md:col-span-2" : "min-w-0"}>
      <span className="mb-1 block truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-xs">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange, type = "text", placeholder = "", readOnly = false }) {
  return <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={readOnly ? "h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" : "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"} />;
}

function Textarea({ value, onChange, rows = 5, placeholder = "" }) {
  return <textarea value={value ?? ""} onChange={onChange} rows={rows} placeholder={placeholder} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-950" />;
}

function Select({ value, onChange, children }) {
  return <select value={value ?? ""} onChange={onChange} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950">{children}</select>;
}

function profileForEditing(profile) {
  return {
    ...profile,
    serviceAreasText: Array.isArray(profile.serviceAreas) ? profile.serviceAreas.join("\n") : "",
    servicesText: profile.services && typeof profile.services === "object" ? Object.entries(profile.services).map(([name, description]) => `${name} | ${description}`).join("\n") : "",
    aboutText: Array.isArray(profile.about) ? profile.about.join("\n") : "",
  };
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
  const [receptionist, setReceptionist] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReceptionistLoading, setIsReceptionistLoading] = useState(!isAdmin);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingReceptionist, setIsSavingReceptionist] = useState(false);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [receptionistSaved, setReceptionistSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setError("This account does not have a business assigned yet.");
      setIsLoading(false);
      setIsReceptionistLoading(false);
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

  useEffect(() => {
    if (!user || !clientId || isAdmin) {
      setIsReceptionistLoading(false);
      return;
    }
    let active = true;
    user.getIdToken(true)
      .then((token) => fetch("/api/receptionist/settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not load AI receptionist business information.");
        if (active) setReceptionist(profileForEditing(data.profile));
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setIsReceptionistLoading(false));
    return () => { active = false; };
  }, [clientId, isAdmin, user]);

  function updateField(field, value) {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateReceptionist(field, value) {
    setReceptionistSaved(false);
    setReceptionist((current) => ({ ...current, [field]: value }));
  }

  function toggleWeekday(day) {
    setReceptionistSaved(false);
    setReceptionist((current) => {
      const days = new Set(current.estimateWeekdays || []);
      if (days.has(day)) days.delete(day); else days.add(day);
      return { ...current, estimateWeekdays: WEEKDAYS.filter((item) => days.has(item)) };
    });
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

  async function saveReceptionist(event) {
    event.preventDefault();
    if (!user || !receptionist) return;
    setIsSavingReceptionist(true);
    setReceptionistSaved(false);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/receptionist/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...receptionist,
          serviceAreas: receptionist.serviceAreasText,
          services: receptionist.servicesText,
          about: receptionist.aboutText,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save AI receptionist business information.");
      setReceptionist(profileForEditing(data.profile));
      setReceptionistSaved(true);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSavingReceptionist(false);
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
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/export", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Client data could not be downloaded.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `${clientId}-client-data.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError.message || "Client data could not be downloaded.");
    } finally {
      setIsDownloading(false);
    }
  }

  const paymentLabel = form.PaymentMethodLabel || "No payment method label is available yet.";
  const billingStatus = form.BillingStatus || "Not configured";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:p-5 md:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-4 sm:mb-7">
          {!isAdmin && <Link href="/" className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm"><span aria-hidden="true">←</span>Back to Clients</Link>}
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Manage your account and the business information used by your AI receptionist.</p>
        </header>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:mb-5 sm:p-4">{error}</div>}
        {saved && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">Account settings saved.</div>}
        {receptionistSaved && <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">AI receptionist business information saved.</div>}

        {isLoading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading settings…</div> : (
          <form id="business-details" onSubmit={saveSettings} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6 md:p-8">
            <h2 className="text-lg font-black sm:text-2xl">Account Details</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-5">
              <Field label="Business Name"><Input value={form.BusinessName} onChange={(event) => updateField("BusinessName", event.target.value)} /></Field>
              <Field label="Owner Name"><Input value={form.OwnerName} onChange={(event) => updateField("OwnerName", event.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={form.AccountEmail} onChange={(event) => updateField("AccountEmail", event.target.value)} /></Field>
              <Field label="Phone"><Input type="tel" value={form.AccountPhone} onChange={(event) => updateField("AccountPhone", event.target.value)} /></Field>
            </div>
            <div className="mt-4 sm:mt-7 sm:flex sm:justify-end"><button type="submit" disabled={isSaving} className="w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:bg-slate-400 sm:w-auto">{isSaving ? "Saving…" : "Save Account"}</button></div>
          </form>
        )}

        {!isAdmin && (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6 md:p-8">
            <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">AI receptionist</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Business Information</h2><p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">Fill this out once, then update it whenever your services, hours, or business information change. These details automatically fill the receptionist’s fixed call script.</p></div>
            {isReceptionistLoading || !receptionist ? <p className="mt-5 rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-500">Loading AI receptionist information…</p> : (
              <form onSubmit={saveReceptionist} className="mt-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Business name"><Input value={receptionist.businessName} onChange={(event) => updateReceptionist("businessName", event.target.value)} /></Field>
                  <Field label="Receptionist name"><Input value={receptionist.receptionistName} onChange={(event) => updateReceptionist("receptionistName", event.target.value)} /></Field>
                  <Field label="Owner name"><Input value={receptionist.ownerName} onChange={(event) => updateReceptionist("ownerName", event.target.value)} /></Field>
                  <Field label="Business phone"><Input value={receptionist.businessPhone} onChange={(event) => updateReceptionist("businessPhone", event.target.value)} /></Field>
                  <Field label="Business email"><Input type="email" value={receptionist.businessEmail} onChange={(event) => updateReceptionist("businessEmail", event.target.value)} /></Field>
                  <Field label="Time zone"><Select value={receptionist.timeZone} onChange={(event) => updateReceptionist("timeZone", event.target.value)}>{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</Select></Field>
                  <Field label="Business hours" wide><Input value={receptionist.businessHours} onChange={(event) => updateReceptionist("businessHours", event.target.value)} placeholder="Monday through Friday. Holiday schedules may affect availability." /></Field>
                  <Field label="Estimate days summary"><Input value={receptionist.estimateDays} onChange={(event) => updateReceptionist("estimateDays", event.target.value)} placeholder="Monday through Friday" /></Field>
                  <Field label="Business base"><Input value={receptionist.businessBase} onChange={(event) => updateReceptionist("businessBase", event.target.value)} placeholder="City, State" /></Field>
                  <Field label="Earliest estimate time"><Select value={receptionist.earliestEstimateStart} onChange={(event) => updateReceptionist("earliestEstimateStart", event.target.value)}>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</Select></Field>
                  <Field label="Latest estimate time"><Select value={receptionist.latestEstimateStart} onChange={(event) => updateReceptionist("latestEstimateStart", event.target.value)}>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</Select></Field>
                  <div className="md:col-span-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-xs">Estimate weekdays</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">{WEEKDAYS.map((day) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold capitalize"><input type="checkbox" checked={(receptionist.estimateWeekdays || []).includes(day)} onChange={() => toggleWeekday(day)} />{day}</label>)}</div></div>
                  <Field label="Service areas" hint="One area per line."><Textarea value={receptionist.serviceAreasText} onChange={(event) => updateReceptionist("serviceAreasText", event.target.value)} /></Field>
                  <Field label="About the business" hint="One fact per line."><Textarea value={receptionist.aboutText} onChange={(event) => updateReceptionist("aboutText", event.target.value)} /></Field>
                  <Field label="Services" hint="One per line: Service | Description" wide><Textarea rows={7} value={receptionist.servicesText} onChange={(event) => updateReceptionist("servicesText", event.target.value)} placeholder="Interior painting | Walls, ceilings, trim, doors, rooms, and indoor surfaces." /></Field>
                  <Field label="Greeting" hint="Use {{business_name}} and {{receptionist_name}} where needed." wide><Input value={receptionist.openingLine} onChange={(event) => updateReceptionist("openingLine", event.target.value)} /></Field>
                  <Field label="Closing" hint="Use {{business_name}} and {{owner_first_name}} where needed." wide><Input value={receptionist.closingLine} onChange={(event) => updateReceptionist("closingLine", event.target.value)} /></Field>
                  <Field label="Extra business information" hint="Common questions, policies, timing, limitations, and facts the receptionist may say." wide><Textarea rows={9} value={receptionist.extraInformation} onChange={(event) => updateReceptionist("extraInformation", event.target.value)} /></Field>
                </div>
                <button type="submit" disabled={isSavingReceptionist} className="mt-5 w-full rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isSavingReceptionist ? "Saving…" : receptionist.configured ? "Update Business Information" : "Finish Business Information"}</button>
              </form>
            )}
          </section>
        )}

        {!isAdmin && (
          <>
            <section id="billing" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Secure billing</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Payment Method</h2></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{billingStatus}</span></div><p className="mt-3 text-sm font-bold text-slate-800">{paymentLabel}</p><button type="button" onClick={openBillingPortal} disabled={isOpeningBilling} className="mt-4 w-full rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-indigo-300 sm:w-auto">{isOpeningBilling ? "Opening Stripe…" : "Manage Payment Method"}</button></section>
            <section id="account-data" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Your information</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Download Client Data</h2><p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">Download a JSON copy of your current records and account details.</p><button type="button" onClick={downloadClientData} disabled={isDownloading} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{isDownloading ? "Preparing Download…" : "Download Client Data"}</button></section>
            <section id="requests" className="mt-4 grid grid-cols-2 gap-3 sm:mt-6"><Link href="/messages?type=change" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-2xl font-black">Change</p><h2 className="mt-1 text-sm font-black">Request a Change</h2></Link><Link href="/messages?type=help" className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm"><p className="text-2xl font-black text-red-600">Help</p><h2 className="mt-1 text-sm font-black">Priority Support</h2></Link></section>
          </>
        )}
      </div>
    </main>
  );
}
