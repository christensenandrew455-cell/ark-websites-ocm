"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getCountFromServer } from "firebase/firestore";
import { db } from "./lib/firebase";

const sections = [
  { title: "Post Clients", sectionKey: "postClients", href: "/post-clients" },
  { title: "Clients", sectionKey: "clients", href: "/clients" },
  { title: "Pre Clients", sectionKey: "preClients", href: "/pre-clients" },
];

function cleanClientId(value) {
  return String(value || "demo-business")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "demo-business";
}

export default function Page() {
  const [clientId, setClientId] = useState("demo-business");
  const [counts, setCounts] = useState({
    postClients: 0,
    clients: 0,
    preClients: 0,
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
            collection(db, "ocmclients", clientId, section.sectionKey)
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
    <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            ARK Websites
          </p>
          <h1 className="mt-3 text-4xl font-bold">OCM Dashboard</h1>
          <p className="mt-3 text-slate-600">
            See how many people are in each client section.
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Current business/client ID
          </p>
          <p className="mt-1 font-mono text-sm text-slate-800">{clientId}</p>
          <p className="mt-2 text-xs text-slate-500">
            Example: /?clientId=tabor-painting keeps that business separate.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {sections.map((section) => (
            <Link
              key={section.sectionKey}
              href={`${section.href}?clientId=${clientId}`}
              className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm hover:border-slate-400"
            >
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                {section.title}
              </p>
              <p className="mt-4 text-5xl font-bold text-slate-950">
                {counts[section.sectionKey] || 0}
              </p>
            </Link>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href={`/pre-clients?clientId=${clientId}`}
            className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Go to Clients
          </Link>
        </div>
      </div>
    </main>
  );
}
