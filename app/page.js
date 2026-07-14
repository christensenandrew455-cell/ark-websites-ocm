"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, doc, getCountFromServer, getDoc } from "firebase/firestore";
import { useAuth } from "./components/AuthProvider";
import { db } from "./lib/firebase";

const sections = [
  { title: "Contacted Me", sectionKey: "contactedMe", href: "/contacted-me", description: "New leads waiting for review" },
  { title: "Pre Clients", sectionKey: "preClients", href: "/pre-clients", description: "Estimate and start-date stage" },
  { title: "Clients", sectionKey: "clients", href: "/clients", description: "Active painting work" },
  { title: "Post Clients", sectionKey: "postClients", href: "/post-clients", description: "Completed customers" },
];

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function Page() {
  const router = useRouter();
  const { profile, isAdmin } = useAuth();
  const [clientId, setClientId] = useState("");
  const [adminInput, setAdminInput] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [counts, setCounts] = useState({ postClients: 0, clients: 0, preClients: 0, contactedMe: 0 });
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const params = new URLSearchParams(window.location.search);
    const selected = isAdmin ? cleanClientId(params.get("clientId")) : profile.clientId;
    const initialClientId = selected || profile.clientId || "";
    setClientId(initialClientId);
    setAdminInput(initialClientId);
  }, [isAdmin, profile]);

  useEffect(() => {
    if (!clientId) return;

    async function loadDashboard() {
      setError("");
      try {
        const businessSnapshot = await getDoc(doc(db, "businesses", clientId));
        setBusinessName(businessSnapshot.exists() ? businessSnapshot.data().businessName : clientId);

        const entries = await Promise.all(
          sections.map(async (section) => {
            const snapshot = await getCountFromServer(collection(db, "ocmClients", clientId, section.sectionKey));
            return [section.sectionKey, snapshot.data().count];
          })
        );
        setCounts(Object.fromEntries(entries));
      } catch (firestoreError) {
        console.error(firestoreError);
        setError("Unable to load this business. Check the client ID and Firebase access rules.");
      }
    }

    loadDashboard();
  }, [clientId]);

  function switchBusiness(event) {
    event.preventDefault();
    if (!isAdmin) return;

    const nextClientId = cleanClientId(adminInput);
    if (!nextClientId) {
      setError("Enter a registered business name or client ID.");
      return;
    }

    setSwitching(true);
    setError("");
    setClientId(nextClientId);
    setBusinessName(nextClientId);
    router.replace(`/?clientId=${encodeURIComponent(nextClientId)}`);
    setSwitching(false);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">ARK Websites</p>
          <h1 className="mt-3 text-4xl font-bold">OCM Dashboard</h1>
          <p className="mt-3 text-slate-600">Choose a stage, or review the complete client pipeline in one place.</p>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Current business/client ID</p>
          {isAdmin ? (
            <form onSubmit={switchBusiness} className="mx-auto mt-2 flex max-w-xl gap-2">
              <input
                value={adminInput}
                onChange={(event) => setAdminInput(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-sm outline-none focus:border-slate-950"
                aria-label="Current business or client ID"
              />
              <button disabled={switching} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {switching ? "Loading…" : "Open"}
              </button>
            </form>
          ) : (
            <p className="mt-1 font-mono text-sm text-slate-800">{clientId}</p>
          )}
          {businessName && <p className="mt-2 text-sm font-semibold text-slate-950">{businessName}</p>}
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <Link href={`/review-my-clients?clientId=${clientId}`} className="mb-6 block rounded-2xl bg-slate-950 p-7 text-white shadow-sm transition hover:bg-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-300">Daily workflow</p>
              <h2 className="mt-2 text-3xl font-bold">Review My Clients</h2>
              <p className="mt-2 text-sm text-slate-300">Accept leads, set start dates, complete jobs, and move clients between stages.</p>
            </div>
            <span className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-slate-950">Open Review</span>
          </div>
        </Link>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {sections.map((section) => (
            <Link key={section.sectionKey} href={`${section.href}?clientId=${clientId}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-400">
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{section.title}</p>
              <p className="mt-4 text-5xl font-bold text-slate-950">{counts[section.sectionKey] || 0}</p>
              <p className="mt-3 text-sm text-slate-600">{section.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
