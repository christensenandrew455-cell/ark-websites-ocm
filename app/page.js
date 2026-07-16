"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useAuth } from "./components/AuthProvider";
import { db } from "./lib/firebase";

const STAGES = [
  { key: "contactedMe", label: "Contacted Me" },
  { key: "preClients", label: "Pre Clients" },
  { key: "clients", label: "Clients" },
  { key: "postClients", label: "Post Clients" },
];

const TIME_RANGES = [
  { key: "today", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

const VISIBILITY_ITEMS = [
  {
    key: "websiteLive",
    label: "Website live and trackable",
    description: "Your website is published and visitor tracking is connected.",
  },
  {
    key: "seoFoundation",
    label: "Basic SEO complete",
    description: "Service, location, page titles, descriptions, and search basics are in place.",
  },
  {
    key: "googleBusiness",
    label: "Google Business Profile complete",
    description: "Your profile is claimed, accurate, and ready to appear in local search.",
  },
  {
    key: "reviewsActive",
    label: "Review collection active",
    description: "Customers are being asked for reviews and recent feedback is visible online.",
  },
  {
    key: "growthChannel",
    label: "A growth channel is active",
    description: "You are consistently posting on social media or running an advertising campaign.",
  },
];

const EMPTY_VISIBILITY = Object.fromEntries(
  VISIBILITY_ITEMS.map((item) => [item.key, false])
);

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

function asDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rangeStart(range) {
  const now = new Date();
  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (range === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return null;
}

function insideRange(value, range) {
  if (range === "all") return true;
  const date = asDate(value);
  if (!date) return false;
  return date >= rangeStart(range);
}

function leadChannel(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("phone") || normalized.includes("call") || normalized.includes("receptionist")) {
    return "phone";
  }
  if (normalized.includes("website") || normalized.includes("form")) {
    return "website";
  }
  return "other";
}

function leadEventsFromProfile(profile) {
  const jobs = Array.isArray(profile.data.Jobs) ? profile.data.Jobs : [];
  if (jobs.length) {
    return jobs.map((job, index) => ({
      id: `${profile.id}:${job.id || index}`,
      profileId: profile.id,
      date: job.createdAt || profile.data.createdAt,
      source: job.source || profile.data.source,
      channel: leadChannel(job.source || profile.data.source),
    }));
  }

  if (!profile.data.source && !profile.data.createdAt) return [];
  return [{
    id: `${profile.id}:legacy`,
    profileId: profile.id,
    date: profile.data.createdAt,
    source: profile.data.source,
    channel: leadChannel(profile.data.source),
  }];
}

function MetricCard({ eyebrow, value, title, description, detail, emphasized = false }) {
  return (
    <article className={emphasized
      ? "rounded-3xl bg-slate-950 p-6 text-white shadow-xl shadow-slate-200/70"
      : "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"}
    >
      <p className={emphasized
        ? "text-xs font-bold uppercase tracking-[0.22em] text-slate-400"
        : "text-xs font-bold uppercase tracking-[0.22em] text-slate-500"}
      >
        {eyebrow}
      </p>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-5xl font-black tracking-tight">{value}</p>
          <h2 className="mt-3 text-lg font-bold">{title}</h2>
        </div>
      </div>
      <p className={emphasized ? "mt-3 text-sm leading-6 text-slate-300" : "mt-3 text-sm leading-6 text-slate-600"}>
        {description}
      </p>
      {detail && (
        <p className={emphasized
          ? "mt-5 border-t border-slate-700 pt-4 text-xs font-semibold text-slate-300"
          : "mt-5 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-500"}
        >
          {detail}
        </p>
      )}
    </article>
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
  const [profiles, setProfiles] = useState([]);
  const [stageCounts, setStageCounts] = useState(Object.fromEntries(STAGES.map((stage) => [stage.key, 0])));
  const [pageViews, setPageViews] = useState([]);
  const [visibility, setVisibility] = useState(EMPTY_VISIBILITY);
  const [range, setRange] = useState("today");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState("");
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
        if (!response.ok) throw new Error("Could not sync business accounts.");
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
      setProfiles([]);
      setPageViews([]);
      setIsLoading(false);
      return;
    }

    let active = true;
    async function loadDashboard() {
      setIsLoading(true);
      setError("");

      try {
        const stagePromises = STAGES.map((stage) => getDocs(collection(db, "ocmClients", clientId, stage.key)));
        const [businessSnapshot, analyticsSnapshot, visibilitySnapshot, ...stageSnapshots] = await Promise.all([
          getDoc(doc(db, "businesses", clientId)),
          getDocs(collection(db, "ocmClients", clientId, "analyticsEvents")),
          getDoc(doc(db, "ocmClients", clientId, "settings", "visibility")),
          ...stagePromises,
        ]);

        if (!active) return;

        const fallbackName = profile?.clientId === clientId ? profile?.businessName : "";
        setBusinessName(
          businessSnapshot.exists()
            ? businessSnapshot.data().businessName || displayNameFromId(clientId)
            : fallbackName || displayNameFromId(clientId)
        );

        const nextProfiles = [];
        const nextStageCounts = {};
        stageSnapshots.forEach((snapshot, index) => {
          const stage = STAGES[index];
          nextStageCounts[stage.key] = snapshot.size;
          snapshot.docs.forEach((documentSnapshot) => {
            nextProfiles.push({
              id: documentSnapshot.id,
              stage: stage.key,
              data: documentSnapshot.data(),
            });
          });
        });

        setProfiles(nextProfiles);
        setStageCounts(nextStageCounts);
        setPageViews(
          analyticsSnapshot.docs
            .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
            .filter((event) => event.eventType === "page_view")
        );
        setVisibility({
          ...EMPTY_VISIBILITY,
          ...(visibilitySnapshot.exists() ? visibilitySnapshot.data() : {}),
        });
      } catch (firestoreError) {
        console.error(firestoreError);
        if (active) setError("Unable to load this business dashboard. Check Firebase access and try again.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, [clientId, profile?.businessName, profile?.clientId, syncVersion]);

  const metrics = useMemo(() => {
    const leadEvents = profiles.flatMap(leadEventsFromProfile);
    const filteredLeads = leadEvents.filter((event) => insideRange(event.date, range));
    const filteredViews = pageViews.filter((event) => insideRange(event.createdAt, range));
    const calls = filteredLeads.filter((event) => event.channel === "phone");
    const forms = filteredLeads.filter((event) => event.channel === "website");
    const connectedLeads = filteredLeads.filter((event) => event.channel !== "other");
    const uniqueContacts = new Set(connectedLeads.map((event) => event.profileId)).size;

    return {
      websiteViews: filteredViews.length,
      phoneCalls: calls.length,
      contactForms: forms.length,
      contactedYou: uniqueContacts,
      usage: filteredLeads.length,
    };
  }, [pageViews, profiles, range]);

  const totalPipeline = Object.values(stageCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const visibilityScore = VISIBILITY_ITEMS.filter((item) => visibility[item.key]).length;
  const visibilityPercent = Math.round((visibilityScore / VISIBILITY_ITEMS.length) * 100);
  const trackingDetected = pageViews.length > 0;

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

  async function toggleVisibility(item) {
    if (!clientId || savingVisibility) return;
    const nextValue = !visibility[item.key];
    setSavingVisibility(item.key);
    setVisibility((current) => ({ ...current, [item.key]: nextValue }));

    try {
      await setDoc(doc(db, "ocmClients", clientId, "settings", "visibility"), {
        [item.key]: nextValue,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (saveError) {
      console.error(saveError);
      setVisibility((current) => ({ ...current, [item.key]: !nextValue }));
      setError("Could not save the visibility checklist.");
    } finally {
      setSavingVisibility("");
    }
  }

  const rangeLabel = TIME_RANGES.find((option) => option.key === range)?.label || "Today";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">
              {businessName || profile?.businessName || "ARK Websites"}
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Performance Dashboard</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
              See whether your website, phone system, and lead flow are producing real activity.
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

        {isAdmin && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <form onSubmit={switchBusiness} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <label htmlFor="business-switcher" className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                  Viewing business
                </label>
                <input
                  id="business-switcher"
                  list="ark-ocm-businesses"
                  value={adminInput}
                  onChange={(event) => setAdminInput(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950"
                  placeholder="Choose a registered business"
                />
                <datalist id="ark-ocm-businesses">
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>{business.businessName || business.id}</option>
                  ))}
                </datalist>
              </div>
              <button disabled={switching} className="mt-auto h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-60">
                {switching ? "Opening…" : "Open Business"}
              </button>
            </form>
          </section>
        )}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {!clientId ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
            No active business account is selected.
          </div>
        ) : isLoading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
            Loading performance data…
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                eyebrow={rangeLabel}
                value={metrics.websiteViews.toLocaleString()}
                title="Website Views"
                description="Tracked visits to your connected website."
                detail={trackingDetected ? "Website tracking has been detected." : "Tracking is ready, but no website views have been received yet."}
                emphasized
              />
              <MetricCard
                eyebrow={rangeLabel}
                value={metrics.phoneCalls.toLocaleString()}
                title="Phone Calls"
                description="Calls that produced a tracked lead through the connected phone system."
                detail="Powered by connected receptionist and phone intake events."
              />
              <MetricCard
                eyebrow={rangeLabel}
                value={metrics.contactedYou.toLocaleString()}
                title="Contacted You"
                description="Unique people who reached the business through a tracked connection."
                detail={`${metrics.phoneCalls.toLocaleString()} calls · ${metrics.contactForms.toLocaleString()} website forms`}
              />
              <MetricCard
                eyebrow={rangeLabel}
                value={metrics.usage.toLocaleString()}
                title="System Usage"
                description="Lead events processed by the website and phone connections."
                detail="Phone-minute and email-send usage can be added when provider reporting is connected."
              />
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Online visibility</p>
                    <h2 className="mt-2 text-3xl font-black tracking-tight">{visibilityScore} out of 5</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      A practical score based on the foundational steps that make a local business easier to discover and trust online.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-950 px-5 py-4 text-center text-white">
                    <p className="text-3xl font-black">{visibilityPercent}%</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">Visibility setup</p>
                  </div>
                </div>

                <div className="mt-6 flex gap-1 text-2xl" aria-label={`${visibilityScore} out of 5 visibility stars`}>
                  {VISIBILITY_ITEMS.map((item, index) => (
                    <span key={item.key} className={index < visibilityScore ? "text-amber-500" : "text-slate-200"}>★</span>
                  ))}
                </div>

                <div className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                  {VISIBILITY_ITEMS.map((item, index) => {
                    const checked = Boolean(visibility[item.key]);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => toggleVisibility(item)}
                        disabled={Boolean(savingVisibility)}
                        className="flex w-full items-start gap-4 bg-white p-4 text-left transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
                      >
                        <span className={checked
                          ? "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white"
                          : "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 border-slate-300 text-xs font-black text-transparent"}
                        >
                          ✓
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-950">{index + 1}. {item.label}</span>
                            {item.key === "websiteLive" && trackingDetected && (
                              <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-green-700">Tracking detected</span>
                            )}
                          </span>
                          <span className="mt-1 block text-sm leading-6 text-slate-600">{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Current pipeline</p>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-6xl font-black tracking-tight">{totalPipeline.toLocaleString()}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-500">Total client records right now</p>
                  </div>
                </div>

                <div className="mt-7 space-y-4">
                  {STAGES.map((stage) => {
                    const count = Number(stageCounts[stage.key] || 0);
                    const percentage = totalPipeline ? Math.round((count / totalPipeline) * 100) : 0;
                    return (
                      <div key={stage.key}>
                        <div className="flex items-center justify-between gap-4 text-sm">
                          <span className="font-bold text-slate-700">{stage.label}</span>
                          <span className="font-black text-slate-950">{count}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-7 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  Use <strong className="text-slate-950">Review My Clients</strong> in the main header when you need individual records, scheduling, or stage changes.
                </div>
              </article>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
