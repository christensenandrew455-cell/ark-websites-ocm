"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

const TIME_RANGES = [
  { key: "today", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function insideRange(value, range) {
  if (range === "all") return true;
  const timestamp = toMillis(value);
  if (!timestamp) return false;
  const now = new Date();
  const start = range === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return timestamp >= start;
}

function StatCard({ value, label, subtitle, onClick, disabled = false, primary = false }) {
  const className = disabled
    ? "border-slate-200 bg-slate-100"
    : primary
      ? "border-slate-950 bg-slate-950 text-white active:scale-[0.99]"
      : "border-slate-200 bg-white active:scale-[0.99]";
  return (
    <button type="button" onClick={onClick} className={`${primary ? "min-h-44 sm:min-h-52" : "min-h-36 sm:min-h-44"} w-full rounded-2xl border p-5 text-left shadow-sm transition sm:rounded-3xl sm:p-7 ${className}`}>
      <div className="flex h-full items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={primary ? "text-sm font-black uppercase tracking-[0.14em] text-slate-300" : "text-xs font-black uppercase tracking-[0.12em] text-slate-700 sm:text-sm"}>{label}</p>
          <p className={primary ? "mt-2 text-xs font-bold text-slate-400 sm:text-sm" : "mt-2 text-[11px] font-bold leading-5 text-slate-400 sm:text-xs"}>{subtitle}</p>
        </div>
        <p className={primary ? "shrink-0 text-6xl font-black tracking-tight text-white sm:text-8xl" : "shrink-0 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl"}>{Number(value || 0).toLocaleString("en-US")}</p>
      </div>
    </button>
  );
}

export default function ClientStats() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const clientId = profile?.clientId || "";
  const [range, setRange] = useState("all");
  const [contacted, setContacted] = useState([]);
  const [clients, setClients] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!clientId) return undefined;
    const unsubscribeContacted = onSnapshot(collection(db, "ocmClients", clientId, "contactedMe"), (snapshot) => setContacted(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), () => setContacted([]));
    const unsubscribeClients = onSnapshot(collection(db, "ocmClients", clientId, "clients"), (snapshot) => setClients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), () => setClients([]));
    return () => { unsubscribeContacted(); unsubscribeClients(); };
  }, [clientId]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    user.getIdToken(true).then(async (token) => {
      if (profile?.messagesEnabled === true) {
        fetch("/api/business/lead-messages", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
          .then(async (response) => response.ok ? response.json() : {})
          .then((data) => { if (active) setConversations(Array.isArray(data.conversations) ? data.conversations : []); })
          .catch(() => { if (active) setConversations([]); });
      } else {
        setConversations([]);
      }
      if (profile?.employeesEnabled === true) {
        fetch("/api/business/employees", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
          .then(async (response) => response.ok ? response.json() : {})
          .then((data) => { if (active) setEmployees(Array.isArray(data.employees) ? data.employees : []); })
          .catch(() => { if (active) setEmployees([]); });
      } else {
        setEmployees([]);
      }
    }).catch(() => null);
    return () => { active = false; };
  }, [profile?.employeesEnabled, profile?.messagesEnabled, user]);

  const counts = useMemo(() => {
    const uniqueLeads = new Map();
    [...contacted, ...clients].forEach((item) => uniqueLeads.set(item.id, item));
    return {
      leads: [...uniqueLeads.values()].filter((item) => insideRange(item.createdAt || item.contactedAt || item.acceptedAt || item.updatedAt, range)).length,
      messages: conversations.filter((item) => insideRange(item.createdAt || item.lastMessageAt, range)).length,
      employees: employees.filter((item) => item.status === "active" && insideRange(item.approvedAt || item.createdAt, range)).length,
    };
  }, [clients, contacted, conversations, employees, range]);

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "Your Business"}</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Your Stats</h1></div>
          <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{TIME_RANGES.map((option) => <button key={option.key} type="button" onClick={() => setRange(option.key)} className={range === option.key ? "rounded-lg bg-slate-950 px-3 py-2.5 text-[11px] font-black text-white sm:px-5 sm:text-sm" : "rounded-lg px-3 py-2.5 text-[11px] font-bold text-slate-500 sm:px-5 sm:text-sm"}>{option.label}</button>)}</div>
        </div>
        {notice && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800"><span>{notice}</span><button type="button" onClick={() => router.push("/settings")} className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-white">Settings</button></div>}
        <div className="mt-5 space-y-3 sm:space-y-4">
          <StatCard primary value={counts.leads} label="Leads" subtitle="Open new leads and accepted clients" onClick={() => router.push("/leads")} />
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <StatCard value={counts.messages} label="Messages" subtitle={profile?.messagesEnabled ? "Open current chats" : "Not turned on"} disabled={profile?.messagesEnabled !== true} onClick={() => openFeature("Messages", profile?.messagesEnabled === true, "/lead-messages")} />
            <StatCard value={counts.employees} label="Employees" subtitle={profile?.employeesEnabled ? "Open employee accounts" : "Not turned on"} disabled={profile?.employeesEnabled !== true} onClick={() => openFeature("Employees", profile?.employeesEnabled === true, "/employees")} />
          </div>
        </div>
      </div>
    </section>
  );
}
