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

  return [{
    id: `${profile.id}:lead`,
    profileId: profile.id,
    date: profile.data.createdAt,
  }];
}

function MetricCard({ value, title, description }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:rounded-3xl sm:p-6 md:p-8">
      <p className="text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{value}</p>
      <h2 className="mt-1.5 text-sm font-black leading-tight sm:mt-3 sm:text-xl">{title}</h2>
      <p className="mt-2 hidden text-sm leading-6 text-slate-600 sm:block">{description}</p>
    </article>
  );
}

function ActionCard({ href, title, description, action }) {
  return (
    <Link
      href={href}
      className="group min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md sm:rounded-3xl sm:p-6 md:p-8"
    >
      <h2 className="text-base font-black leading-tight tracking-tight sm:text-2xl">{title}</h2>
      <p className="mt-2 hidden text-sm leading-6 text-slate-600 sm:block">{description}</p>
      <p className="mt-3 text-xs font-black text-slate-950 sm:mt-6 sm:text-sm">
        {action} <span aria-hidden="true" className="transition group-hover:translate-x-1">→</span>
      </p>
    </Link>
  );
}

export default function HomePage() {
  const { profile } = useAuth();
  const clientId = profile?.clientId || "";
  const [businessName, setBusinessName] = useState(profile?.businessName || "Your Business");
  const [profiles, setProfiles] = useState([]);
  const [range, setRange] = useState("today");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setIsLoading(false);
      setError("This account does not have a business assigned yet.");
      return undefined;
    }

    let active = true;

    async function loadHomeScreen() {
      setIsLoading(true);
      setError("");

      try {
        const [businessSnapshot, ...stageSnapshots] = await Promise.all([
          getDoc(doc(db, "businesses", clientId)),
          ...STAGES.map((stage) => getDocs(collection(db, "ocmClients", clientId, stage))),
        ]);

        if (!active) return;

        if (businessSnapshot.exists()) {
          setBusinessName(businessSnapshot.data().businessName || profile?.businessName || "Your Business");
        } else {
          setBusinessName(profile?.businessName || "Your Business");
        }

        const nextProfiles = [];
        stageSnapshots.forEach((snapshot, index) => {
          snapshot.docs.forEach((documentSnapshot) => {
            nextProfiles.push({
              id: documentSnapshot.id,
              stage: STAGES[index],
              data: documentSnapshot.data(),
            });
          });
        });
        setProfiles(nextProfiles);
      } catch (loadError) {
        console.error(loadError);
        if (active) setError("Unable to load this business account. Check the Firebase connection and try again.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadHomeScreen();
    return () => {
      active = false;
    };
  }, [clientId, profile?.businessName]);

  const metrics = useMemo(() => {
    const events = profiles.flatMap(eventsFromProfile).filter((event) => insideRange(event.date, range));
    return {
      contactedYou: new Set(events.map((event) => event.profileId)).size,
      usage: events.length,
    };
  }, [profiles, range]);

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:px-5 sm:py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 sm:mb-8 sm:flex sm:items-end sm:justify-between sm:gap-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500 sm:text-xs sm:tracking-[0.28em]">{businessName}</p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:mt-3 sm:text-4xl md:text-5xl">Home</h1>
            <p className="mt-2 hidden max-w-2xl text-base leading-7 text-slate-600 sm:block">
              See who contacted the business, review system activity, and open the tools you use most.
            </p>
          </div>

          <div className="mt-3 grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:mt-0 sm:inline-flex sm:w-fit sm:rounded-2xl sm:p-1.5">
            {TIME_RANGES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={range === option.key
                  ? "rounded-lg bg-slate-950 px-2 py-2 text-xs font-bold text-white shadow-sm sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm"
                  : "rounded-lg px-2 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-950 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm"}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:mb-6 sm:rounded-2xl sm:p-4">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm sm:rounded-3xl sm:p-12">
            Loading business activity…
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 sm:gap-5">
              <MetricCard
                value={metrics.contactedYou.toLocaleString()}
                title="Contacted You"
                description={`Unique people who contacted ${businessName} during the selected time period.`}
              />
              <MetricCard
                value={metrics.usage.toLocaleString()}
                title="System Usage"
                description="Lead and job intake events processed by the AI receptionist and client center."
              />
            </section>

            <section className="mt-3 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-5">
              <ActionCard
                href="/review-my-clients"
                title="Review My Clients"
                description="Open incoming leads and existing client records, then accept, update, or review them."
                action="Open clients"
              />
              <ActionCard
                href="/settings"
                title="Settings"
                description={`Update the business and notification details used by the ${businessName} client center.`}
                action="Open settings"
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
