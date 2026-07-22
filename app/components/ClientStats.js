"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
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
  map.set(id, {
    eventType,
    occurredAt: occurredAt || serverTimestamp(),
    sourceId,
  });
}

function addRowCandidates(map, row, accepted) {
  const sourceId = safeId(row.id);
  const contactedAt = row.createdAt || row.updatedAt || row.acceptedAt;
  addCandidate(map, `contacted:${sourceId}`, "contacted", contactedAt, row.id);

  const jobs = Array.isArray(row.Jobs) ? row.Jobs : [];
  if (jobs.length) {
    jobs.forEach((job, index) => {
      const jobId = safeId(job?.id || index);
      addCandidate(
        map,
        `usage:${sourceId}:job:${jobId}`,
        "usage",
        job?.createdAt || contactedAt,
        row.id
      );
    });
  } else {
    addCandidate(map, `usage:${sourceId}:lead`, "usage", contactedAt, row.id);
  }

  if (accepted) {
    const acceptedAt = row.acceptedAt || row.updatedAt || row.createdAt;
    addCandidate(map, `client:${sourceId}`, "client", acceptedAt, row.id);
  }
}

async function writeMissingEvents(clientId, events) {
  for (let index = 0; index < events.length; index += 50) {
    const group = events.slice(index, index + 50);
    await Promise.all(group.map(([id, data]) => setDoc(
      doc(db, "ocmClients", clientId, "statsEvents", id),
      data,
      { merge: true }
    )));
  }
}

function StatCard({ value, label }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm sm:p-6">
      <p className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{value.toLocaleString()}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 sm:text-xs">{label}</p>
    </div>
  );
}

function currentMonthKey(timeZone = "UTC") {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}`;
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
}

function ReceptionistUsageCard({ usage, loading }) {
  const includedMinutes = Math.max(1, Number(usage?.includedMinutes || 1500));
  const activeMonth = usage?.monthKey === currentMonthKey(usage?.timeZone || "UTC");
  const usedMinutes = loading || !activeMonth
    ? 0
    : Math.ceil(Math.max(0, Number(usage?.totalSeconds || 0)) / 60);
  const percentage = Math.max(0, (usedMinutes / includedMinutes) * 100);
  const displayedPercentage = Math.min(100, percentage);
  const barClass = percentage >= 75
    ? "bg-red-500"
    : percentage >= 50
      ? "bg-amber-400"
      : "bg-emerald-500";

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-4 sm:p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 sm:text-xs">AI Receptionist Usage This Month</p>
          <p className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            {usedMinutes.toLocaleString()}
            <span className="ml-1 text-sm font-black text-slate-500 sm:text-base">of {includedMinutes.toLocaleString()} minutes</span>
          </p>
        </div>
        <p className="shrink-0 text-sm font-black text-slate-500">{Math.round(percentage)}%</p>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="AI receptionist monthly minutes"
        aria-valuemin={0}
        aria-valuemax={includedMinutes}
        aria-valuenow={Math.min(usedMinutes, includedMinutes)}
      >
        <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${displayedPercentage}%` }} />
      </div>
    </div>
  );
}

function StatsPanel({ events, loading, usage, usageLoading }) {
  const [range, setRange] = useState("all");
  const counts = useMemo(() => {
    const visible = events.filter((event) => eventInsideRange(event, range));
    return {
      contacted: visible.filter((event) => event.eventType === "contacted").length,
      clients: visible.filter((event) => event.eventType === "client").length,
    };
  }, [events, range]);

  return (
    <section className="bg-transparent py-1 sm:py-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">Your Stats</h2>
        <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {TIME_RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              className={range === option.key
                ? "rounded-lg bg-slate-950 px-2 py-2 text-[11px] font-black text-white shadow-sm sm:px-4 sm:text-sm"
                : "rounded-lg px-2 py-2 text-[11px] font-bold text-slate-500 hover:text-slate-950 sm:px-4 sm:text-sm"}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:mt-4 sm:gap-4">
        <StatCard value={loading ? 0 : counts.contacted} label="Contacted You" />
        <StatCard value={loading ? 0 : counts.clients} label="Clients" />
      </div>
      <ReceptionistUsageCard usage={usage} loading={usageLoading} />
    </section>
  );
}

export default function ClientStats() {
  const { profile } = useAuth();
  const clientId = profile?.clientId || "";
  const [mountNode, setMountNode] = useState(null);
  const [contacted, setContacted] = useState([]);
  const [clients, setClients] = useState([]);
  const [contactedLoaded, setContactedLoaded] = useState(false);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [receptionistUsage, setReceptionistUsage] = useState(null);
  const [usageLoaded, setUsageLoaded] = useState(false);

  useEffect(() => {
    let slot;
    let observer;
    let pageHeader;
    let businessLabel;

    function attach() {
      const container = document.querySelector(".client-home main > div");
      const cards = container?.querySelector(":scope > section.grid.grid-cols-2");
      const header = container?.querySelector(":scope > header");
      if (!container || !cards || !header) return false;

      pageHeader = header;
      businessLabel = header.querySelector("p");
      if (businessLabel) businessLabel.style.display = "none";

      header.classList.remove("mb-4", "sm:mb-8");
      header.classList.add("mb-3", "mt-3", "sm:mb-5", "sm:mt-5");

      slot = document.querySelector(".client-stats-slot");
      if (!slot) slot = document.createElement("div");
      slot.className = "client-stats-slot";
      container.insertBefore(slot, header);
      setMountNode(slot);
      return true;
    }

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      if (businessLabel) businessLabel.style.removeProperty("display");
      if (pageHeader) {
        pageHeader.classList.remove("mb-3", "mt-3", "sm:mb-5", "sm:mt-5");
        pageHeader.classList.add("mb-4", "sm:mb-8");
      }
      if (slot?.parentNode) slot.parentNode.removeChild(slot);
      setMountNode(null);
    };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;

    setContacted([]);
    setClients([]);
    setContactedLoaded(false);
    setClientsLoaded(false);
    setEvents([]);
    setEventsLoaded(false);
    setReceptionistUsage(null);
    setUsageLoaded(false);

    const unsubscribeUsage = onSnapshot(
      doc(db, "ocmClients", clientId, "usage", "receptionist-current"),
      (snapshot) => {
        setReceptionistUsage(snapshot.exists() ? snapshot.data() : null);
        setUsageLoaded(true);
      },
      (error) => {
        console.error("Could not load receptionist usage", error);
        setUsageLoaded(true);
      }
    );

    const unsubscribeEvents = onSnapshot(
      collection(db, "ocmClients", clientId, "statsEvents"),
      (snapshot) => {
        setEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setEventsLoaded(true);
      },
      (error) => {
        console.error("Could not load client stats", error);
        setEventsLoaded(true);
      }
    );

    const unsubscribeContacted = onSnapshot(
      collection(db, "ocmClients", clientId, "contactedMe"),
      (snapshot) => {
        setContacted(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setContactedLoaded(true);
      },
      () => setContactedLoaded(true)
    );

    const unsubscribeClients = onSnapshot(
      collection(db, "ocmClients", clientId, "clients"),
      (snapshot) => {
        setClients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setClientsLoaded(true);
      },
      () => setClientsLoaded(true)
    );

    return () => {
      unsubscribeUsage();
      unsubscribeEvents();
      unsubscribeContacted();
      unsubscribeClients();
    };
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !eventsLoaded || !contactedLoaded || !clientsLoaded) return;

    const candidates = new Map();
    contacted.forEach((row) => addRowCandidates(candidates, row, false));
    clients.forEach((row) => addRowCandidates(candidates, row, true));

    const existingIds = new Set(events.map((event) => event.id));
    const missing = [...candidates.entries()].filter(([id]) => !existingIds.has(id));
    if (!missing.length) return;

    writeMissingEvents(clientId, missing).catch((error) => {
      console.error("Could not preserve client stats", error);
    });
  }, [clientId, clients, clientsLoaded, contacted, contactedLoaded, events, eventsLoaded]);

  if (!mountNode) return null;
  return createPortal(
    <StatsPanel
      events={events}
      loading={!eventsLoaded}
      usage={receptionistUsage}
      usageLoading={!usageLoaded}
    />,
    mountNode
  );
}
