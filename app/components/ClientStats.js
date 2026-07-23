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

function StatsPanel({ events, loading }) {
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
    <StatsPanel events={events} loading={!eventsLoaded} />,
    mountNode
  );
}
