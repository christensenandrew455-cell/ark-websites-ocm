"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { db } from "./lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";

const sections = [
  { title: "Contacted Me", sectionKey: "contactedMe", description: "New leads waiting for review" },
  { title: "Pre Clients", sectionKey: "preClients", description: "Estimate and start-date stage" },
  { title: "Clients", sectionKey: "clients", description: "Active painting work" },
  { title: "Post Clients", sectionKey: "postClients", description: "Completed customers" },
];

const utilityCards = [
  {
    title: "Advertising",
    eyebrow: "Client targeting",
    description: "Search and filter every client by stage and job type.",
    href: "/advertising",
    action: "Open Advertising",
  },
  {
    title: "Settings",
    eyebrow: "Account controls",
    description: "Manage account details, billing information, subscription status, and payment-method notes.",
    href: "/settings",
    action: "Open Settings",
  },
];

function cleanClientId(value) {
  return String(value || DEFAULT_CLIENT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || DEFAULT_CLIENT_ID;
}

export default function Page() {
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [counts, setCounts] = useState({
    postClients: 0,
    clients: 0,
    preClients: 0,
    contactedMe: 0,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(cleanClientId(params.get("clientId")));
  }, []);

  useEffect(() => {
    async function loadCounts() {
      try {
        const sectionCounts = {};
        for (const section of sections) {
          const snapshot = await getCountFromServer(
            collection(db, "ocmClients", clientId, section.sectionKey)
          );
          sectionCounts[section.sectionKey] = snapshot.data().count;
        }
        setCounts(sectionCounts);
      } catch (firestoreError) {
        console.error(firestoreError);
        setError("Firestore is not connected yet. Check your Firebase env variables and Firestore rules.");
      }
    }

    loadCounts();
  }, [clientId]);

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">ARK Websites</p>
          <h1 className="mt-3 text-4xl font-bold">OCM Dashboard</h1>
          <p className="mt-3 text-slate-600">Review the pipeline, target clients, or manage the account.</p>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Current business/client ID</p>
          <p className="mt-1 font-mono text-sm text-slate-800">{clientId}</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <Link
          href={`/review-my-clients?clientId=${clientId}`}
          className="mb-6 block rounded-2xl bg-slate-950 p-7 text-white shadow-sm transition hover:bg-slate-800"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-300">Daily workflow</p>
              <h2 className="mt-2 text-3xl font-bold">Review My Clients</h2>
              <p className="mt-2 text-sm text-slate-300">Accept leads, set start dates, complete jobs, and move clients between stages.</p>
            </div>
            <span className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-slate-950">Open Review</span>
          </div>
        </Link>

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {utilityCards.map((card) => (
            <Link
              key={card.href}
              href={`${card.href}?clientId=${clientId}`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-400 hover:shadow-md"
            >
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{card.eyebrow}</p>
              <h2 className="mt-2 text-2xl font-bold">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{card.description}</p>
              <span className="mt-5 inline-block rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">{card.action}</span>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {sections.map((section) => (
            <div
              key={section.sectionKey}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{section.title}</p>
              <p className="mt-4 text-5xl font-bold text-slate-950">{counts[section.sectionKey] || 0}</p>
              <p className="mt-3 text-sm text-slate-600">{section.description}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
