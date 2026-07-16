"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "./lib/firebase";

const CLIENT_ID = "tabor-painting";
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
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <p className="text-5xl font-black tracking-tight text-slate-950">{value}</p>
      <h2 className="mt-3 text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </article>
  );
}

function ActionCard({ href, title, description, action }) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md md:p-8"
    >
      <h2 className="text-2xl font-black tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      <p className="mt-6 text-sm font-black text-slate-950">
        {action} <span aria-hidden="true" className="transition group-hover:translate-x-1">→</span>
      </p>
    </Link>
  );
}

export default function HomePage() {
  const [businessName, setBusinessName] = useState("Tabor Painting");
  const [profiles, setProfiles] = useState([]);
  const [range, setRange] = useState("today");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadHomeScreen() {
      setIsLoading(true);
      setError("");

      try {
        const [businessSnapshot, ...stageSnapshots] = await Promise.all([
          getDoc(doc(db, "businesses", CLIENT_ID)),
          ...STAGES.map((stage) => getDocs(collection(db, "ocmClients", CLIENT_ID, stage))),
        ]);

        if (!active) return;

        if (businessSnapshot.exists()) {
          setBusinessName(businessSnapshot.data().businessName || "Tabor Painting");
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
        if (active) setError("Unable to load Tabor Painting data. Check the Firebase connection and try again.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadHomeScreen();
    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const events = profiles.flatMap(eventsFromProfile).filter((event) => insideRange(event.date, range));
    return {
      contactedYou: new Set(events.map((event) => event.profileId)).size,
      usage: events.length,
    };
  }, [profiles, range]);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">{businessName}</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Home Screen</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
              See who contacted the business, review system activity, and open the tools you use most.
            </p>
          </div>

          <div className="inline-flex w-fit rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            {TIME_RANGES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={range === option.key
                  ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm"
                  : "rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-950"}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
            Loading Tabor Painting activity…
          </div>
        ) : (
          <>
            <section className="grid gap-5 sm:grid-cols-2">
              <MetricCard
                value={metrics.contactedYou.toLocaleString()}
                title="Contacted You"
                description="Unique people who contacted Tabor Painting during the selected time period."
              />
              <MetricCard
                value={metrics.usage.toLocaleString()}
                title="System Usage"
                description="Lead and job intake events processed by the AI receptionist and client center."
              />
            </section>

            <section className="mt-6 grid gap-5 sm:grid-cols-2">
              <ActionCard
                href="/review-my-clients"
                title="Review My Clients"
                description="Open incoming leads and existing client records, then accept, update, or review them."
                action="Open client center"
              />
              <ActionCard
                href="/settings"
                title="Settings"
                description="Update the business and notification details used by the Tabor Painting client center."
                action="Open settings"
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
