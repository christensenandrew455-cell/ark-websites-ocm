"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";
const stageConfigs = [
  { key: "contactedMe", label: "Contacted Me" },
  { key: "preClients", label: "Pre Clients" },
  { key: "clients", label: "Clients" },
  { key: "postClients", label: "Post Clients" },
];
const stageNavItems = [
  { label: "Contacted Me", href: "/contacted-me" },
  { label: "Pre Clients", href: "/pre-clients" },
  { label: "Clients", href: "/clients" },
  { label: "Post Clients", href: "/post-clients" },
];
const utilityNavItems = [
  { label: "Review My Clients", href: "/review-my-clients" },
  { label: "Advertising", href: "/advertising" },
  { label: "Settings", href: "/settings" },
  { label: "Dashboard", href: "/" },
];

function cleanClientId(value) {
  return String(value || DEFAULT_CLIENT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || DEFAULT_CLIENT_ID;
}

function normalizeContactMethod(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["text", "sms", "message", "text message"].includes(normalized)) return "Text";
  if (["call", "phone", "telephone"].includes(normalized)) return "Call";
  if (["email", "e-mail"].includes(normalized)) return "Email";
  return "";
}

function normalizeRow(id, data, stage) {
  return {
    ...data,
    id,
    stageKey: stage.key,
    stageLabel: stage.label,
    Name: data.Name || data.name || data.fullName || "",
    Phone: data.Phone || data.phone || data.phoneNumber || data.contact || "",
    Email: data.Email || data.email || "",
    Address: data.Address || data.address || "",
    Job: data.Job || data.job || data.service || data.projectType || "",
    BestContactMethod: normalizeContactMethod(
      data.BestContactMethod || data.bestContactMethod || data.BestFormOfContact || data.bestFormOfContact || data.BestWayToContact || data.bestWayToContact || data.preferredContactMethod || data.contactMethod
    ),
    Notes: data.Notes || data.notes || data.message || "",
  };
}

function NavLink({ item, pathname, clientId }) {
  return (
    <Link
      href={`${item.href}?clientId=${clientId}`}
      className={pathname === item.href
        ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}
    >
      {item.label}
    </Link>
  );
}

function contactAction(row) {
  const phone = String(row.Phone || "").replace(/[^\d+]/g, "");
  if (row.BestContactMethod === "Text" && phone) return { href: `sms:${phone}`, label: "Text Client" };
  if (row.BestContactMethod === "Call" && phone) return { href: `tel:${phone}`, label: "Call Client" };
  if (row.BestContactMethod === "Email" && row.Email) return { href: `mailto:${row.Email}`, label: "Email Client" };
  return null;
}

export default function AdvertisingClients() {
  const pathname = usePathname();
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [rowsByStage, setRowsByStage] = useState({ contactedMe: [], preClients: [], clients: [], postClients: [] });
  const [loadedStages, setLoadedStages] = useState(new Set());
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [contactFilter, setContactFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(cleanClientId(params.get("clientId")));
  }, []);

  useEffect(() => {
    setRowsByStage({ contactedMe: [], preClients: [], clients: [], postClients: [] });
    setLoadedStages(new Set());
    setError("");

    const unsubscribers = stageConfigs.map((stage) => onSnapshot(
      collection(db, "ocmClients", clientId, stage.key),
      (snapshot) => {
        const rows = snapshot.docs.map((document) => normalizeRow(document.id, document.data(), stage));
        setRowsByStage((current) => ({ ...current, [stage.key]: rows }));
        setLoadedStages((current) => new Set(current).add(stage.key));
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load clients for advertising. Check Firebase settings and permissions.");
      }
    ));

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [clientId]);

  const allRows = useMemo(
    () => stageConfigs.flatMap((stage) => rowsByStage[stage.key] || []),
    [rowsByStage]
  );

  const jobOptions = useMemo(() => Array.from(new Set(
    allRows.map((row) => String(row.Job || "").trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b)), [allRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (stageFilter && row.stageKey !== stageFilter) return false;
      if (jobFilter && row.Job !== jobFilter) return false;
      if (contactFilter && row.BestContactMethod !== contactFilter) return false;
      if (!term) return true;

      return [row.Name, row.Phone, row.Email, row.Address, row.Job, row.BestContactMethod, row.Notes]
        .some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [allRows, contactFilter, jobFilter, search, stageFilter]);

  const isLoading = loadedStages.size < stageConfigs.length;
  const filtersActive = Boolean(search || stageFilter || jobFilter || contactFilter);

  function clearFilters() {
    setSearch("");
    setStageFilter("");
    setJobFilter("");
    setContactFilter("");
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 overflow-x-auto pb-2">
          <div className="flex min-w-max items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <div className="flex gap-1">
              {stageNavItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} clientId={clientId} />)}
            </div>
            <div className="flex gap-1">
              {utilityNavItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} clientId={clientId} />)}
            </div>
          </div>
        </nav>

        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{clientId}</p>
          <h1 className="mt-1 text-4xl font-bold">Advertising</h1>
          <p className="mt-2 max-w-3xl text-slate-600">Find the exact clients you want to contact by pipeline stage, job type, and their preferred contact method.</p>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="lg:col-span-4">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Search</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, phone, email, address, job, or notes..."
                className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Client Stage</span>
              <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
                <option value="">All stages</option>
                {stageConfigs.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Job Type</span>
              <select value={jobFilter} onChange={(event) => setJobFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
                <option value="">All job types</option>
                {jobOptions.map((job) => <option key={job} value={job}>{job}</option>)}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Best Form of Contact</span>
              <select value={contactFilter} onChange={(event) => setContactFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
                <option value="">All contact methods</option>
                <option value="Text">Text</option>
                <option value="Call">Call</option>
                <option value="Email">Email</option>
              </select>
            </label>

            <div className="flex items-end">
              <button onClick={clearFilters} disabled={!filtersActive} className="h-11 w-full rounded-lg border border-slate-300 px-4 text-sm font-bold hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400">
                Clear Filters
              </button>
            </div>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-600">{isLoading ? "Loading clients..." : `${filteredRows.length} matching client${filteredRows.length === 1 ? "" : "s"}`}</p>
          <p className="text-xs text-slate-500">Clients without a saved contact method can still be found with search.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {!isLoading && filteredRows.map((row) => {
            const action = contactAction(row);
            return (
              <article key={`${row.stageKey}:${row.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold">{row.Name || "Unnamed client"}</h2>
                    <p className="mt-1 text-sm font-medium text-slate-600">{row.Job || "No job type saved"}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{row.stageLabel}</span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Best Contact</p>
                    <p className="mt-1 text-sm font-semibold">{row.BestContactMethod || "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Phone</p>
                    <p className="mt-1 break-words text-sm">{row.Phone || "—"}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Email</p>
                    <p className="mt-1 break-words text-sm">{row.Email || "—"}</p>
                  </div>
                  {row.Address && (
                    <div className="sm:col-span-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Address</p>
                      <p className="mt-1 break-words text-sm">{row.Address}</p>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {action ? (
                    <a href={action.href} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">{action.label}</a>
                  ) : (
                    <span className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">Set a valid contact method first</span>
                  )}
                  <Link href={`/${row.stageKey === "contactedMe" ? "contacted-me" : row.stageKey === "preClients" ? "pre-clients" : row.stageKey === "postClients" ? "post-clients" : "clients"}?clientId=${clientId}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100">
                    Open Stage
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        {!isLoading && filteredRows.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">No clients match these filters.</div>
        )}
      </div>
    </main>
  );
}
