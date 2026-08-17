"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL } from "../lib/launchFeatures";

function DashboardCard({ value, label, description, onClick, disabled = false, tourId = "" }) {
  const displayValue = typeof value === "number" ? value.toLocaleString("en-US") : String(value ?? "0");
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      data-tour-id={tourId || undefined}
      className={disabled
        ? "min-h-28 w-full cursor-not-allowed rounded-2xl border border-slate-300 bg-slate-200 p-5 text-left opacity-70 shadow-sm sm:min-h-32 sm:rounded-3xl sm:p-6"
        : "min-h-28 w-full rounded-2xl border border-slate-300 bg-slate-50 p-5 text-left shadow-sm transition active:scale-[0.99] sm:min-h-32 sm:rounded-3xl sm:p-6"}
    >
      <div className="flex h-full items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{label}</h2>
          <p className="mt-2 text-sm font-semibold leading-5 text-slate-500">{description}</p>
        </div>
        <p className="shrink-0 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{displayValue}</p>
      </div>
    </button>
  );
}

function displayPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return String(value || "").trim();
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export default function ClientStats() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [newLeads, setNewLeads] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const profilePhone = String(profile?.receptionistPhone || profile?.receptionistPhoneNormalized || "").trim();
  const [receptionistPhone, setReceptionistPhone] = useState(profilePhone);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setReceptionistPhone(profilePhone);
  }, [profilePhone]);

  const loadNewCounts = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const requests = [
        fetch("/api/receptionist/settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
          .then(async (response) => { if (!response.ok) throw new Error("Could not refresh the receptionist number."); return response.json(); })
          .then((data) => setReceptionistPhone(String(data?.profile?.receptionistPhone || data?.profile?.receptionistPhoneNormalized || profilePhone).trim()))
          .catch(() => setReceptionistPhone(profilePhone)),
        fetch("/api/business/leads?summary=1", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
          .then(async (response) => { if (!response.ok) throw new Error("Could not refresh the lead count."); return response.json(); })
          .then((data) => setNewLeads(Number(data.contactedCount || 0)))
          .catch(() => null),
      ];
      if (profile?.messagesEnabled === true) {
        requests.push(fetch("/api/business/lead-messages", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
          .then(async (response) => { if (!response.ok) throw new Error("Could not refresh the message count."); return response.json(); })
          .then((data) => setUnreadMessages(Number(data.unreadCount || 0)))
          .catch(() => setUnreadMessages(0)));
      } else {
        setUnreadMessages(0);
      }
      await Promise.all(requests);
    } catch {
      setUnreadMessages(0);
      setReceptionistPhone(profilePhone);
    }
  }, [profile?.messagesEnabled, profilePhone, user]);

  useEffect(() => {
    loadNewCounts();
    const timer = window.setInterval(loadNewCounts, 15000);
    const onVisibility = () => { if (document.visibilityState === "visible") loadNewCounts(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadNewCounts]);

  function openFeature(feature, enabled, href) {
    if (!enabled) {
      setNotice(`You do not currently have ${feature} turned on. Open Settings to enable it.`);
      return;
    }
    router.push(href);
  }

  const numberPending = !receptionistPhone;

  return (
    <section className="ark-dashboard-page min-h-[calc(100vh-78px)] bg-slate-200 px-3 py-4 text-slate-950 sm:px-5 sm:py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">Tap a workspace to see what needs your attention.</p>
        </div>
        {notice && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-800"><span>{notice}</span><button type="button" onClick={() => router.push("/settings")} className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-white">Settings</button></div>}
        <section className={numberPending ? "mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:rounded-3xl sm:p-5" : "mt-5 rounded-2xl border border-slate-300 bg-slate-50 p-4 shadow-sm sm:rounded-3xl sm:p-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 sm:text-xs">Your AI receptionist number</p></div>
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{receptionistPhone ? displayPhone(receptionistPhone) : "Your number is being assigned"}</p>
          {numberPending && <div className="mt-3 border-t border-blue-200 pt-3"><p className="text-xs font-semibold leading-5 text-blue-950">Most businesses receive their number within 24–48 hours. Thank you for your patience.</p></div>}
        </section>
        <section className="mt-3 rounded-[2rem] border border-slate-300 bg-slate-300/70 p-3 shadow-inner sm:mt-5 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <DashboardCard tourId="dashboard-leads" value={newLeads} label="Leads" description="Accept new leads and view your clients." onClick={() => router.push("/leads")} />
            <DashboardCard tourId="dashboard-messages" value={MESSAGES_AVAILABLE ? unreadMessages : "?"} label="Messages" description={MESSAGES_AVAILABLE ? "Text clients from your dedicated business number." : UPCOMING_FEATURE_LABEL} onClick={() => MESSAGES_AVAILABLE ? openFeature("Messages", profile?.messagesEnabled === true, "/lead-messages") : router.push("/lead-messages")} />
          </div>
        </section>
      </div>
    </section>
  );
}
