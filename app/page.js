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

const dashboardNavItems = [
  { label: "Review My Clients", href: "/review-my-clients" },
  { label: "Advertising", href: "/advertising" },
  { label: "Settings", href: "/settings" },
  { label: "Dashboard", href: "/" },
];

const primaryActions = [
  {
    title: "Review My Clients",
    eyebrow: "Daily workflow",
    description: "Accept leads, set start dates, complete jobs, and move clients through each stage.",
    href: "/review-my-clients",
    action: "Open Review",
    primary: true,
  },
  {
    title: "Advertising",
    eyebrow: "Client targeting",
    description: "Search and filter your customer list by stage, job type, and contact information.",
    href: "/advertising",
    action: "Open Advertising",
    primary: false,
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

function DashboardNav({ clientId }) {
  return (
    <nav className="mb-8 overflow-x-auto pb-2">
      <div className="flex min-w-max items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        {dashboardNavItems.map((item) => (
          <Link
            key={item.href}
            href={`${item.href}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`}
            className={item.href === "/"
              ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
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
        <DashboardNav clientId={clientId} />

        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            {businessName || profile?.businessName || "ARK Websites"}
          </p>
          <h1 className="mt-2 text-4xl font-bold">Dashboard</h1>
          <p className="mt-2 text-slate-600">See your client pipeline and open the tools you use most.</p>
        </div>

        {isAdmin && (
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Open a business account</p>
            <form onSubmit={switchBusiness} className="mt-3 flex max-w-xl gap-2">
              <input
                list="ark-ocm-businesses"
                value={adminInput}
                onChange={(event) => setAdminInput(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
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
            {businessName && <p className="mt-3 text-sm font-semibold text-slate-700">Currently viewing: {businessName}</p>}
          </div>
        )}

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        {clientId ? (
          <>
            <section className="mb-8">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Client overview</p>
                  <h2 className="mt-1 text-2xl font-bold">Pipeline totals</h2>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
                  <p className="text-sm font-semibold uppercase tracking-widest text-slate-300">Total Records</p>
                  <p className="mt-4 text-5xl font-bold">{totalPipeline}</p>
                  <p className="mt-3 text-sm text-slate-300">Everyone currently in your pipeline</p>
                </div>

                {sections.map((section) => (
                  <div key={section.sectionKey} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{section.title}</p>
                    <p className="mt-4 text-5xl font-bold text-slate-950">{counts[section.sectionKey] || 0}</p>
                    <p className="mt-3 text-sm text-slate-600">{section.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Main tools</p>
                <h2 className="mt-1 text-2xl font-bold">What would you like to do?</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {primaryActions.map((card) => (
                  <Link
                    key={card.href}
                    href={`${card.href}?clientId=${encodeURIComponent(clientId)}`}
                    className={card.primary
                      ? "rounded-2xl bg-slate-950 p-7 text-white shadow-sm transition hover:bg-slate-800"
                      : "rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:border-slate-400 hover:shadow-md"}
                  >
                    <p className={card.primary
                      ? "text-xs font-bold uppercase tracking-[0.25em] text-slate-300"
                      : "text-xs font-bold uppercase tracking-[0.25em] text-slate-500"}
                    >
                      {card.eyebrow}
                    </p>
                    <h3 className="mt-2 text-3xl font-bold">{card.title}</h3>
                    <p className={card.primary ? "mt-2 text-sm text-slate-300" : "mt-2 text-sm text-slate-600"}>
                      {card.description}
                    </p>
                    <span className={card.primary
                      ? "mt-6 inline-block rounded-lg bg-white px-5 py-3 text-sm font-bold text-slate-950"
                      : "mt-6 inline-block rounded-lg bg-slate-950 px-5 py-3 text-sm font-bold text-white"}
                    >
                      {card.action}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">No active business accounts are available.</div>
        )}
      </div>
    </main>
  );
}
