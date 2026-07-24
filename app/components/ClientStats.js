"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

function StatCard({ value, label, subtitle, onClick, disabled = false }) {
  return (
    <button type="button" onClick={onClick} className={disabled
      ? "rounded-2xl border border-slate-200 bg-slate-100 p-4 text-left shadow-sm sm:p-6"
      : "rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.98] sm:p-6"}>
      <p className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{Number(value || 0).toLocaleString("en-US")}</p>
      <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700 sm:text-sm">{label}</p>
      <p className="mt-1 text-[10px] font-bold leading-4 text-slate-400 sm:text-xs">{subtitle}</p>
    </button>
  );
}

export default function ClientStats() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const clientId = profile?.clientId || "";
  const [contactedCount, setContactedCount] = useState(0);
  const [clientCount, setClientCount] = useState(0);
  const [billing, setBilling] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!clientId) return undefined;
    const unsubscribeContacted = onSnapshot(collection(db, "ocmClients", clientId, "contactedMe"), (snapshot) => setContactedCount(snapshot.size), () => setContactedCount(0));
    const unsubscribeClients = onSnapshot(collection(db, "ocmClients", clientId, "clients"), (snapshot) => setClientCount(snapshot.size), () => setClientCount(0));
    return () => { unsubscribeContacted(); unsubscribeClients(); };
  }, [clientId]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    user.getIdToken(true)
      .then((token) => fetch("/api/billing/monthly-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => { if (active && response.ok) setBilling(data); })
      .catch(() => null);
    return () => { active = false; };
  }, [user]);

  function openFeature(feature, enabled, href) {
    if (!enabled) {
      setNotice(`You do not currently have ${feature} turned on. Open Settings to enable it.`);
      return;
    }
    router.push(href);
  }

  return (
    <section className="min-h-[calc(100vh-78px)] bg-slate-50 px-3 py-5 text-slate-950 sm:px-5 sm:py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "Your Business"}</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Your Stats</h1></div>
        {notice && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800"><span>{notice}</span><button type="button" onClick={() => router.push("/settings")} className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-white">Settings</button></div>}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatCard value={contactedCount + clientCount} label="Leads" subtitle="Open new leads and clients" onClick={() => router.push("/leads")} />
          <StatCard value={billing?.messageCount || 0} label="Messages" subtitle={profile?.messagesEnabled ? "Open current chats" : "Not turned on"} disabled={profile?.messagesEnabled !== true} onClick={() => openFeature("Messages", profile?.messagesEnabled === true, "/lead-messages")} />
          <StatCard value={billing?.employeeCount || 0} label="Employees" subtitle={profile?.employeesEnabled ? "Open employee accounts" : "Not turned on"} disabled={profile?.employeesEnabled !== true} onClick={() => openFeature("Employees", profile?.employeesEnabled === true, "/employees")} />
        </div>
      </div>
    </section>
  );
}
