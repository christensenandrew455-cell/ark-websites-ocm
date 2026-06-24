"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const columns = ["Name", "Phone", "Email", "Address", "Job", "Notes"];

const sections = [
  { title: "Post Clients", storageKey: "ark-post-clients" },
  { title: "Clients", storageKey: "ark-clients" },
  { title: "Pre Clients", storageKey: "ark-pre-clients" },
];

function countRows(storageKey) {
  const savedRows = localStorage.getItem(storageKey);

  if (!savedRows) {
    return 0;
  }

  const rows = JSON.parse(savedRows);

  return rows.filter((row) =>
    columns.some((column) => String(row[column]).trim() !== "")
  ).length;
}

export default function Page() {
  const [counts, setCounts] = useState({
    "ark-post-clients": 0,
    "ark-clients": 0,
    "ark-pre-clients": 0,
  });

  useEffect(() => {
    setCounts({
      "ark-post-clients": countRows("ark-post-clients"),
      "ark-clients": countRows("ark-clients"),
      "ark-pre-clients": countRows("ark-pre-clients"),
    });
  }, []);

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

        <div className="grid gap-4 md:grid-cols-3">
          {sections.map((section) => (
            <div
              key={section.storageKey}
              className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
            >
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                {section.title}
              </p>
              <p className="mt-4 text-5xl font-bold text-slate-950">
                {counts[section.storageKey]}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/pre-clients"
            className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Go to Clients
          </Link>
        </div>
      </div>
    </main>
  );
}
