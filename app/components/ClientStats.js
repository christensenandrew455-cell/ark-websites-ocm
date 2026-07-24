"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
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
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function safeId(value) {
  return String(value || "event").replaceAll("/", "_");
}

function eventInsideRange(event, range) {
  if (range === "all") return true;
  const value = toMillis(event.occurredAt);
  if (!value) return false;
  const now = new Date();
  const start = range === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return value >= start;
}

function addCandidate(map, id, eventType, occurredAt, sourceId) {
  map.set(id, { eventType, occurredAt: occurredAt || serverTimestamp(), sourceId });
}

function addRowCandidates(map, row, accepted) {
  const sourceId = safeId(row.id);
  const contactedAt = row.createdAt || row.updatedAt || row.acceptedAt;
  addCandidate(map, `contacted:${sourceId}`, "contacted", contactedAt, row.id);
  if (accepted) {
    const acceptedAt = row.acceptedAt || row.updatedAt || row.createdAt;
    addCandidate(map, `client:${sourceId}`, "client", acceptedAt, row.id);
  }
}

async function writeMissingEvents(clientId, events) {
  for (let index = 0; index < events.length; index += 50) {
    const group = events.slice(index, index + 50);
    await Promise.all(group.map(([id, data]) => setDoc(doc(db, "ocmClients", clientId, "statsEvents", id), data, { merge: true })));
  }
}

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
  const [range, setRange] = useState("all");
  const [contacted, setContacted] = useState([]);
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [billing, setBilling] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!clientId) return undefined;
    setLoaded(false);
    const unsubscribeEvents = onSnapshot(collection(db, "ocmClients", clientId, "statsEvents"), (snapshot) => {
      setEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setLoaded(true);
    }, () => setLoaded(true));
    const unsubscribeContacted = onSnapshot(collection(db, "ocmClients", clientId, "contactedMe"), (snapshot) => setContacted(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));
    const unsubscribeClients = onSnapshot(collection(db, "ocmClients", clientId, "clients"), (snapshot) => setClients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));
    return () => { unsubscribeEvents(); unsubscribeContacted(); unsubscribeClients(); };
  }, [clientId]);

  useEffect(() => {
    if (!clientId || (!contacted.length && !clients.length)) return;
    const candidates = new Map();
    contacted.forEach((row) => addRowCandidates(candidates, row, false));
    clients.forEach((row) => addRowCandidates(candidates, row, true));
    const existingIds = new Set(events.map((event) => event.id));
    const missing = [...candidates.entries()].filter(([id]) => !existingIds.has(id));
    if (missing.length) writeMissingEvents(clientId, missing).catch((error) => console.error("Could not preserve client stats", error));
  }, [clientId, clients, contacted, events]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken(true).then((token) => fetch("/api/billing/monthly-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => { if (active && response.ok) setBilling(data); })
      .catch(() => null);
    return () => { active = false; };
  }, [user]);

  const counts = useMemo(() => {
    const visible = events.filter((event) => eventInsideRange(event, range));
    return {
      contacted: visible.filter((event) => event.eventType === "contacted").length,
      clients: visible.filter((event) => event.eventType === "client").length,
    };
  }, [events, range]);

  function openFeature(feature, enabled, href) {
    if (!enabled) {
      setNotice(`You do not currently have ${feature} turned on. Open Settings to enable it.`);
      return;
    }
    router.push(href);
  }

  return (
    <section className="bg-slate-50 px-3 pt-4 text-slate-950 sm:px-5 sm:pt-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "Your Business"}</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Your Stats</h1></div>
          <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{TIME_RANGES.map((option) => <button key={option.key} type="button" onClick={() => setRange(option.key)} className={range === option.key ? "rounded-lg bg-slate-950 px-2 py-2 text-[11px] font-black text-white sm:px-4 sm:text-sm" : "rounded-lg px-2 py-2 text-[11px] font-bold text-slate-500 sm:px-4 sm:text-sm"}>{option.label}</button>)}</div>
        </div>
        {notice && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800"><span>{notice}</span><button type="button" onClick={() => router.push("/settings")} className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-white">Settings</button></div>}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard value={loaded ? counts.contacted : 0} label="Contacted You" subtitle="Open new receptionist leads" onClick={() => router.push("/?section=contacted")} />
          <StatCard value={loaded ? counts.clients : 0} label="Clients" subtitle="Open accepted clients" onClick={() => router.push("/?section=clients")} />
          <StatCard value={billing?.messageCount || 0} label="Messages" subtitle={profile?.messagesEnabled ? "Open conversations" : "Not turned on"} disabled={profile?.messagesEnabled !== true} onClick={() => openFeature("Messages", profile?.messagesEnabled === true, "/lead-messages")} />
          <StatCard value={billing?.employeeCount || 0} label="Employees" subtitle={profile?.employeesEnabled ? "Open employee accounts" : "Not turned on"} disabled={profile?.employeesEnabled !== true} onClick={() => openFeature("Employees", profile?.employeesEnabled === true, "/employees")} />
        </div>
      </div>
    </section>
  );
}
