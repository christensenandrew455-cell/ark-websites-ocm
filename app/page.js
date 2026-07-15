"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, doc, getCountFromServer, getDoc, getDocs } from "firebase/firestore";
import { useAuth } from "./components/AuthProvider";
import { db } from "./lib/firebase";

const sections = [
  { title: "Contacted Me", sectionKey: "contactedMe", description: "New leads waiting for review" },
  { title: "Pre Clients", sectionKey: "preClients", description: "Estimate and start-date stage" },
  { title: "Clients", sectionKey: "clients", description: "Active customers and work" },
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
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function displayNameFromId(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export default function Page() {
  const router = useRouter();
  const {
    user,
    profile,
    isAdmin,
    activeClientId,
    selectClientId,
  } = useAuth();
  const [clientId, setClientId] = useState("");
  const [adminInput, setAdminInput] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businesses, setBusinesses] = useState([]);
  const [counts, setCounts] = useState({ postClients: 0, clients: 0, preClients: 0, contactedMe: 0 });
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);

  useEffect(() => {
    if (!profile) return;
    const params = new URLSearchParams(window.location.search);
    const requested = cleanClientId(params.get("clientId"));
    const selected = isAdmin
      ? requested || cleanClientId(activeClientId) || cleanClientId(profile.clientId)
      : cleanClientId(profile.clientId);

    setClientId(selected);
    setAdminInput(selected);
    if (selected) selectClientId(selected);
  }, [activeClientId, isAdmin, profile, selectClientId]);

  useEffect(() => {
    if (!isAdmin || !user) return;

    let active = true;
    async function syncBusinessAccounts() {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/admin/sync-business-clients", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Could not sync business accounts into the admin CRM.");
        }
        if (active) setSyncVersion((current) => current + 1);
      } catch (syncError) {
        console.error("Unable to sync business accounts", syncError);
      }
    }

    syncBusinessAccounts();
    return () => {
      active = false;
    };
  }, [isAdmin, user]);

  useEffect(() => {
    if (!isAdmin) return;

    async function loadBusinesses() {
      try {
        const snapshot = await getDocs(collection(db, "businesses"));
        const options = snapshot.docs
          .map((businessDocument) => ({ id: businessDocument.id, ...businessDocument.data() }))
          .filter((business) => business.status === "active")
          .sort((a, b) => String(a.businessName || a.id).localeCompare(String(b.businessName || b.id)));
        setBusinesses(options);

        const selectedExists = options.some((business) => business.id === clientId);
        if (!selectedExists && options[0]?.id) {
          const fallbackId = cleanClientId(profile?.clientId) || options[0].id;
          const nextClientId = options.some((business) => business.id === fallbackId) ? fallbackId : options[0].id;
          setClientId(nextClientId);
          setAdminInput(nextClientId);
          selectClientId(nextClientId);
          router.replace(`/?clientId=${encodeURIComponent(nextClientId)}`);
        }
      } catch (businessError) {
        console.error("Unable to load business list", businessError);
      }
    }

    loadBusinesses();
  }, [clientId, isAdmin, profile?.clientId, router, selectClientId, syncVersion]);

  useEffect(() => {
    if (!clientId) {
      setBusinessName("");
      setCounts({ postClients: 0, clients: 0, preClients: 0, contactedMe: 0 });
      return;
    }

    async function loadDashboard() {
      setError("");
      try {
        const businessSnapshot = await getDoc(doc(db, "businesses", clientId));
        const fallbackName = profile?.clientId === clientId ? profile?.businessName : "";
        setBusinessName(
          businessSnapshot.exists()
            ? businessSnapshot.data().businessName || displayNameFromId(clientId)
            : fallbackName || displayNameFromId(clientId)
        );

        const entries = await Promise.all(
          sections.map(async (section) => {
            const snapshot = await getCountFromServer(collection(db, "ocmClients", clientId, section.sectionKey));
            return [section.sectionKey, snapshot.data().count];
          })
        );
        setCounts(Object.fromEntries(entries));
      } catch (firestoreError) {
        console.error(firestoreError);
        setError("Unable to load this business. Check the selected business and Firebase access rules.");
      }
    }

    loadDashboard();
  }, [clientId, profile?.businessName, profile?.clientId, syncVersion]);

  async function switchBusiness(event) {
    event.preventDefault();
    if (!isAdmin) return;

    const selectedBusiness = businesses.find((business) => (
      business.id === adminInput || String(business.businessName || "").toLowerCase() === adminInput.trim().toLowerCase()
    ));
    const nextClientId = selectedBusiness?.id || cleanClientId(adminInput);
    if (!nextClientId || !businesses.some((business) => business.id === nextClientId)) {
      setError("Choose a registered business.");
      return;
    }

    setSwitching(true);
    setError("");
    setClientId(nextClientId);
    setAdminInput(nextClientId);
    selectClientId(nextClientId);
    router.replace(`/?clientId=${encodeURIComponent(nextClientId)}`);
    setSwitching(false);
  }

  const totalPipeline = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{businessName || "ARK Websites"}</p>
            <h1 className="mt-2 text-4xl font-bold">Business Pipeline</h1>
            <p className="mt-2 text-slate-600">See the numbers first, then open the work that needs attention.</p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-6 py-4 text-white shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">Total records</p>
            <p className="mt-1 text-4xl font-bold">{totalPipeline}</p>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {isAdmin ? "Open a business account" : "Current business"}
          </p>
          {isAdmin ? (
            <form onSubmit={switchBusiness} className="mx-auto mt-3 flex max-w-xl gap-2">
              <input
                list="ark-ocm-businesses"
                value={adminInput}
                onChange={(event) => setAdminInput(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-center text-sm outline-none focus:border-slate-950"
                aria-label="Business name or client ID"
                placeholder="Choose a registered business"
              />
              <datalist id="ark-ocm-businesses">
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>{business.businessName || business.id}</option>
                ))}
              </datalist>
              <button disabled={switching} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {switching ? "Loading…" : "Open"}
              </button>
            </form>
          ) : (
            <>
              <p className="mt-2 text-lg font-bold text-slate-950">{businessName || profile?.businessName || "Business account"}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">{clientId}</p>
            </>
          )}
          {isAdmin && businessName && <p className="mt-3 text-sm font-semibold text-slate-950">Currently viewing: {businessName}</p>}
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        {clientId ? (
          <>
            <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {sections.map((section) => (
                <Link
                  key={section.sectionKey}
                  href={`/${section.sectionKey === "contactedMe" ? "contacted-me" : section.sectionKey === "preClients" ? "pre-clients" : section.sectionKey === "postClients" ? "post-clients" : "clients"}?clientId=${clientId}`}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-400 hover:shadow-md"
                >
                  <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{section.title}</p>
                  <p className="mt-4 text-5xl font-bold text-slate-950">{counts[section.sectionKey] || 0}</p>
                  <p className="mt-3 text-sm text-slate-600">{section.description}</p>
                </Link>
              ))}
            </div>

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

            <div className="grid gap-4 md:grid-cols-2">
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
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">No active business accounts are available.</div>
        )}
      </div>
    </main>
  );
}
