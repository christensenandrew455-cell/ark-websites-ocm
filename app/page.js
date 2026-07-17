"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useAuth } from "./components/AuthProvider";
import { db } from "./lib/firebase";

const STAGES = ["contactedMe", "preClients", "clients", "postClients"];
const TIME_RANGES = [
  { key: "today", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

function asDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rangeStart(range) {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

function insideRange(value, range) {
  if (range === "all") return true;
  const date = asDate(value);
  return Boolean(date && date >= rangeStart(range));
}

function eventsFromProfile(profile) {
  const jobs = Array.isArray(profile.data.Jobs) ? profile.data.Jobs : [];
  if (jobs.length) {
    return jobs.map((job, index) => ({
      id: `${profile.id}:${job.id || index}`,
      profileId: profile.id,
      date: job.createdAt || profile.data.createdAt,
    }));
  }
  return [{ id: `${profile.id}:lead`, profileId: profile.id, date: profile.data.createdAt }];
}

function profileDate(profile) {
  return profile.data.acceptedAt || profile.data.movedAt || profile.data.updatedAt || profile.data.createdAt;
}

function MetricCard({ value, title, onClick }) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition active:scale-[0.98] sm:rounded-3xl sm:p-6 md:p-8">
      <p className="text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{value}</p>
      <h2 className="mt-1.5 text-[11px] font-black leading-tight text-slate-700 sm:mt-3 sm:text-xl">{title}</h2>
      <p className="mt-2 text-[10px] font-bold text-slate-400 sm:text-sm">Tap for details</p>
    </button>
  );
}

function MetricModal({ metric, onClose }) {
  if (!metric) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={metric.title}>
      <button type="button" className="fixed inset-0" onClick={onClose} aria-label="Close details" />
      <section className="relative w-full rounded-3xl bg-white p-6 shadow-2xl sm:max-w-lg sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-5xl font-black tracking-tight text-slate-950">{metric.value}</p><h2 className="mt-2 text-2xl font-black">{metric.title}</h2></div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold">Close</button>
        </div>
        <p className="mt-5 text-base leading-7 text-slate-600">{metric.description}</p>
      </section>
    </div>
  );
}

async function adminApi(user, url) {
  const token = await user.getIdToken(true);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load the administrator dashboard.");
  return data;
}

function AdminDashboard({ user }) {
  const [metrics, setMetrics] = useState({ openMessages: 0, customers: 0, phones: 0, unread: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      adminApi(user, "/api/requests"),
      adminApi(user, "/api/admin/connections"),
      adminApi(user, "/api/admin/notifications"),
    ])
      .then(([requestData, connectionData, notificationData]) => {
        if (!active) return;
        const requests = requestData.requests || [];
        const businesses = connectionData.businesses || [];
        const notifications = notificationData.businesses || [];
        setMetrics({
          openMessages: requests.filter((item) => item.status === "new" || item.status === "in-progress").length,
          customers: businesses.length,
          phones: notifications.reduce((total, item) => total + Number(item.enabledDeviceCount || 0), 0),
          unread: notifications.reduce((total, item) => total + Number(item.unreadLeadCount || 0), 0),
        });
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [user]);

  const cards = [
    { href: "/messages", value: metrics.openMessages, title: "Open Messages", detail: "Help and change requests waiting for your attention." },
    { href: "/connections", value: metrics.customers, title: "Connections", detail: "Customer accounts and receptionist connections." },
    { href: "/notifications", value: metrics.phones, title: "Phones Enabled", detail: "Customer phones currently registered for push notifications." },
    { href: "/notifications", value: metrics.unread, title: "Unread Alerts", detail: "Lead notifications customers have not marked as viewed." },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-7"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">ARK OCM Admin</p><h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl">Dashboard</h1></header>
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {isLoading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading administrator dashboard…</div> : (
          <section className="grid grid-cols-2 gap-3 sm:gap-5">
            {cards.map((card) => (
              <Link key={`${card.href}:${card.title}`} href={card.href} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:scale-[0.99] sm:rounded-3xl sm:p-7">
                <p className="text-4xl font-black sm:text-5xl">{card.value}</p>
                <h2 className="mt-1 text-sm font-black sm:text-xl">{card.title}</h2>
                <p className="mt-2 text-[10px] font-semibold leading-4 text-slate-500 sm:text-sm sm:leading-6">{card.detail}</p>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function CustomerDashboard({ profile }) {
  const clientId = profile?.clientId || "";
  const [businessName, setBusinessName] = useState(profile?.businessName || "Your Business");
  const [profiles, setProfiles] = useState([]);
  const [range, setRange] = useState("today");
  const [activeMetric, setActiveMetric] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setIsLoading(false);
      setError("This account does not have a business assigned yet.");
      return undefined;
    }
    let active = true;
    async function loadDashboard() {
      setIsLoading(true);
      setError("");
      try {
        const [businessSnapshot, ...stageSnapshots] = await Promise.all([
          getDoc(doc(db, "businesses", clientId)),
          ...STAGES.map((stage) => getDocs(collection(db, "ocmClients", clientId, stage))),
        ]);
        if (!active) return;
        setBusinessName(businessSnapshot.exists() ? businessSnapshot.data().businessName || profile?.businessName || "Your Business" : profile?.businessName || "Your Business");
        const nextProfiles = [];
        stageSnapshots.forEach((snapshot, index) => snapshot.docs.forEach((documentSnapshot) => nextProfiles.push({ id: documentSnapshot.id, stage: STAGES[index], data: documentSnapshot.data() })));
        setProfiles(nextProfiles);
      } catch (loadError) {
        console.error(loadError);
        if (active) setError("Unable to load this business account. Check the Firebase connection and try again.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadDashboard();
    return () => { active = false; };
  }, [clientId, profile?.businessName]);

  const metrics = useMemo(() => {
    const events = profiles.flatMap(eventsFromProfile).filter((event) => insideRange(event.date, range));
    const acceptedProfiles = profiles.filter((item) => item.stage !== "contactedMe" && insideRange(profileDate(item), range));
    return {
      contactedYou: new Set(events.map((event) => event.profileId)).size,
      usage: events.length,
      clients: new Set(acceptedProfiles.map((item) => item.id)).size,
    };
  }, [profiles, range]);

  const rangeLabel = TIME_RANGES.find((option) => option.key === range)?.label || "Selected period";
  const metricDetails = {
    contacted: { value: metrics.contactedYou.toLocaleString(), title: "Contacted You", description: `This is the number of unique people recorded as contacting ${businessName} for ${rangeLabel.toLowerCase()}.` },
    usage: { value: metrics.usage.toLocaleString(), title: "System Usage", description: `This currently counts lead and job intake activity recorded by the client center for ${rangeLabel.toLowerCase()}. It does not yet represent billable call minutes or remaining plan usage.` },
    clients: { value: metrics.clients.toLocaleString(), title: "Clients", description: `This is the number of accepted client records added during ${rangeLabel.toLowerCase()}. Open the Clients tab to review the actual people.` },
  };

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:px-5 sm:py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 sm:mb-8 sm:flex sm:items-end sm:justify-between sm:gap-6">
          <div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500 sm:text-xs">{businessName}</p><h1 className="mt-1.5 text-3xl font-black tracking-tight sm:text-4xl md:text-5xl">Dashboard</h1></div>
          <div className="mt-3 grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:mt-0 sm:inline-flex sm:w-fit sm:p-1.5">
            {TIME_RANGES.map((option) => <button key={option.key} type="button" onClick={() => setRange(option.key)} className={range === option.key ? "rounded-lg bg-slate-950 px-2 py-2 text-xs font-bold text-white shadow-sm sm:px-4 sm:py-2.5 sm:text-sm" : "rounded-lg px-2 py-2 text-xs font-bold text-slate-500 sm:px-4 sm:py-2.5 sm:text-sm"}>{option.label}</button>)}
          </div>
        </header>
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {isLoading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading dashboard…</div> : (
          <section className="grid grid-cols-3 gap-2.5 sm:gap-5">
            <MetricCard value={metricDetails.contacted.value} title={metricDetails.contacted.title} onClick={() => setActiveMetric(metricDetails.contacted)} />
            <MetricCard value={metricDetails.usage.value} title={metricDetails.usage.title} onClick={() => setActiveMetric(metricDetails.usage)} />
            <MetricCard value={metricDetails.clients.value} title={metricDetails.clients.title} onClick={() => setActiveMetric(metricDetails.clients)} />
          </section>
        )}
      </div>
      <MetricModal metric={activeMetric} onClose={() => setActiveMetric(null)} />
    </main>
  );
}

export default function HomePage() {
  const { user, profile, isAdmin, loading } = useAuth();
  if (loading || !user) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading dashboard…</main>;
  return isAdmin ? <AdminDashboard user={user} /> : <CustomerDashboard profile={profile} />;
}
