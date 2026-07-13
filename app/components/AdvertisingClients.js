"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";
const MAX_IMAGES = 4;
const MAX_STORED_IMAGE_BYTES = 650000;
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
const deliveryOptions = [
  { value: "email", label: "Email only" },
  { value: "text", label: "Text only" },
  { value: "best", label: "Best contact method only" },
  { value: "both", label: "Both email and text" },
];
const cadenceOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
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

function hasPhone(row) {
  return String(row.Phone || "").replace(/\D/g, "").length >= 7;
}

function hasEmail(row) {
  return /^\S+@\S+\.\S+$/.test(String(row.Email || "").trim());
}

function getDeliveryCounts(rows, method) {
  const emailDeliveries = rows.filter(hasEmail).length;
  const textDeliveries = rows.filter(hasPhone).length;
  const bestDeliveries = rows.filter((row) => (
    (row.BestContactMethod === "Email" && hasEmail(row)) ||
    (row.BestContactMethod === "Text" && hasPhone(row))
  )).length;

  if (method === "email") {
    return { recipients: emailDeliveries, deliveries: emailDeliveries, emailDeliveries, textDeliveries: 0 };
  }
  if (method === "text") {
    return { recipients: textDeliveries, deliveries: textDeliveries, emailDeliveries: 0, textDeliveries };
  }
  if (method === "best") {
    return {
      recipients: bestDeliveries,
      deliveries: bestDeliveries,
      emailDeliveries: rows.filter((row) => row.BestContactMethod === "Email" && hasEmail(row)).length,
      textDeliveries: rows.filter((row) => row.BestContactMethod === "Text" && hasPhone(row)).length,
    };
  }

  return {
    recipients: rows.filter((row) => hasEmail(row) || hasPhone(row)).length,
    deliveries: emailDeliveries + textDeliveries,
    emailDeliveries,
    textDeliveries,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not open that image."));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not compress that image."));
    }, "image/jpeg", quality);
  });
}

async function compressImage(file) {
  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceUrl);
  const maxDimension = 1400;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare that image.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let blob;
  for (const quality of [0.78, 0.64, 0.5, 0.38]) {
    blob = await canvasToBlob(canvas, quality);
    if (blob.size <= MAX_STORED_IMAGE_BYTES) break;
  }

  if (!blob || blob.size > MAX_STORED_IMAGE_BYTES) {
    throw new Error(`${file.name} is still too large after compression.`);
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name || "pasted-image.jpg",
    type: "image/jpeg",
    size: blob.size,
    dataUrl: await readFileAsDataUrl(blob),
  };
}

function Modal({ children, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button className="fixed inset-0 cursor-default" aria-label="Close ad composer" onClick={onClose} />
      <div className="relative mx-auto my-6 max-w-3xl rounded-3xl bg-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}

export default function AdvertisingClients() {
  const pathname = usePathname();
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [rowsByStage, setRowsByStage] = useState({ contactedMe: [], preClients: [], clients: [], postClients: [] });
  const [loadedStages, setLoadedStages] = useState(new Set());
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("email");
  const [emailSubject, setEmailSubject] = useState("");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState([]);
  const [repeatAd, setRepeatAd] = useState(false);
  const [repeatCadence, setRepeatCadence] = useState("weekly");
  const [firstSendAt, setFirstSendAt] = useState("");
  const [imageError, setImageError] = useState("");
  const [composerError, setComposerError] = useState("");
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [isStartingAd, setIsStartingAd] = useState(false);

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

  const filtersActive = Boolean(search || stageFilter || jobFilter);
  const filteredRows = useMemo(() => {
    if (!filtersActive) return [];
    const term = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (stageFilter && row.stageKey !== stageFilter) return false;
      if (jobFilter && row.Job !== jobFilter) return false;
      if (!term) return true;

      return [row.Name, row.Phone, row.Email, row.Address, row.Job, row.BestContactMethod, row.Notes]
        .some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [allRows, filtersActive, jobFilter, search, stageFilter]);

  const isLoading = loadedStages.size < stageConfigs.length;
  const campaignAudience = filtersActive ? filteredRows : allRows;
  const deliveryCounts = useMemo(
    () => getDeliveryCounts(campaignAudience, deliveryMethod),
    [campaignAudience, deliveryMethod]
  );
  const includesEmail = deliveryMethod === "email" || deliveryMethod === "both" || deliveryMethod === "best";

  function clearFilters() {
    setSearch("");
    setStageFilter("");
    setJobFilter("");
  }

  function resetComposer() {
    setDeliveryMethod("email");
    setEmailSubject("");
    setMessage("");
    setImages([]);
    setRepeatAd(false);
    setRepeatCadence("weekly");
    setFirstSendAt("");
    setImageError("");
    setComposerError("");
  }

  function closeComposer() {
    if (isStartingAd) return;
    setShowComposer(false);
    resetComposer();
  }

  async function addImages(files) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      setImageError(`You can attach up to ${MAX_IMAGES} images.`);
      return;
    }

    setIsProcessingImages(true);
    setImageError("");
    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const compressed = [];
      for (const file of imageFiles.slice(0, remainingSlots)) {
        compressed.push(await compressImage(file));
      }
      setImages((current) => [...current, ...compressed]);
      if (imageFiles.length > remainingSlots) {
        setImageError(`Only the first ${remainingSlots} image${remainingSlots === 1 ? " was" : "s were"} added.`);
      }
    } catch (processingError) {
      console.error(processingError);
      setImageError(processingError.message || "Could not add one of those images.");
    } finally {
      setIsProcessingImages(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    addImages(event.dataTransfer.files);
  }

  function handlePaste(event) {
    const pastedImages = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!pastedImages.length) return;
    event.preventDefault();
    addImages(pastedImages);
  }

  async function startAd(event) {
    event.preventDefault();
    setComposerError("");

    if (!message.trim()) {
      setComposerError("Write the ad message before starting it.");
      return;
    }
    if ((deliveryMethod === "email" || deliveryMethod === "both") && !emailSubject.trim()) {
      setComposerError("Add an email subject for this delivery method.");
      return;
    }
    if (repeatAd && !firstSendAt) {
      setComposerError("Choose the first send date and time for the repeating ad.");
      return;
    }
    if (!campaignAudience.length) {
      setComposerError("There are no clients in this audience.");
      return;
    }
    if (!deliveryCounts.deliveries) {
      setComposerError("None of these clients have the contact information needed for this delivery method.");
      return;
    }

    setIsStartingAd(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const campaignRef = await addDoc(collection(db, "ocmClients", clientId, "advertisingCampaigns"), {
        status: "preparing",
        deliveryMethod,
        emailSubject: includesEmail ? emailSubject.trim() : "",
        message: message.trim(),
        targeting: {
          allClients: !filtersActive,
          search: search.trim(),
          stage: stageFilter,
          jobType: jobFilter,
        },
        audienceCount: campaignAudience.length,
        recipientCount: deliveryCounts.recipients,
        deliveryCount: deliveryCounts.deliveries,
        emailDeliveryCount: deliveryCounts.emailDeliveries,
        textDeliveryCount: deliveryCounts.textDeliveries,
        repeat: {
          enabled: repeatAd,
          cadence: repeatAd ? repeatCadence : "",
          firstSendAt: repeatAd ? new Date(firstSendAt).toISOString() : "",
        },
        assetCount: images.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const assetIds = [];
      for (const image of images) {
        const assetRef = await addDoc(collection(db, "ocmClients", clientId, "advertisingAssets"), {
          campaignId: campaignRef.id,
          name: image.name,
          type: image.type,
          size: image.size,
          dataUrl: image.dataUrl,
          createdAt: serverTimestamp(),
        });
        assetIds.push(assetRef.id);
      }

      await setDoc(campaignRef, {
        status: repeatAd ? "scheduled" : "queued",
        assetIds,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setSuccess(`Ad queued for ${deliveryCounts.recipients} client${deliveryCounts.recipients === 1 ? "" : "s"}.`);
      setShowComposer(false);
      resetComposer();
    } catch (startError) {
      console.error(startError);
      setComposerError("Could not queue the ad. Check Firebase settings and permissions, then try again.");
    } finally {
      setIsStartingAd(false);
    }
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
          <p className="mt-2 max-w-3xl text-slate-600">Choose a client stage or job type, preview the audience, and create one-time or repeating ads.</p>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {success && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">{success}</div>}

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

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setSuccess("");
                  setShowComposer(true);
                }}
                className="h-11 w-full rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"
              >
                New Ad
              </button>
            </div>

            <div className="flex items-end">
              <button type="button" onClick={clearFilters} disabled={!filtersActive} className="h-11 w-full rounded-lg border border-slate-300 px-4 text-sm font-bold hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400">
                Clear Filters
              </button>
            </div>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-600">
            {isLoading
              ? "Loading clients..."
              : filtersActive
                ? `${filteredRows.length} matching client${filteredRows.length === 1 ? "" : "s"}`
                : "Choose a filter or search to preview clients."}
          </p>
          <p className="text-xs text-slate-500">New Ad uses all clients when no filters are selected.</p>
        </div>

        {filtersActive && (
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
        )}

        {!isLoading && filtersActive && filteredRows.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">No clients match these filters.</div>
        )}
      </div>

      {showComposer && (
        <Modal onClose={closeComposer}>
          <form onSubmit={startAd}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 md:p-7">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Advertising campaign</p>
                <h2 className="mt-1 text-3xl font-bold">New Ad</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {filtersActive
                    ? `${campaignAudience.length} clients match the current filters.`
                    : `No filters selected. This targets all ${campaignAudience.length} clients.`}
                </p>
              </div>
              <button type="button" onClick={closeComposer} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100" aria-label="Close">
                Close
              </button>
            </div>

            <div className="space-y-6 p-5 md:p-7">
              {composerError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{composerError}</div>}

              <section>
                <h3 className="text-lg font-bold">Send Through</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {deliveryOptions.map((option) => (
                    <label key={option.value} className={deliveryMethod === option.value ? "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-950 bg-slate-50 p-4" : "flex cursor-pointer items-center gap-3 rounded-xl border border-slate-300 p-4 hover:bg-slate-50"}>
                      <input type="radio" name="deliveryMethod" value={option.value} checked={deliveryMethod === option.value} onChange={(event) => setDeliveryMethod(event.target.value)} />
                      <span className="text-sm font-bold">{option.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
                  <span className="font-bold">{deliveryCounts.recipients} reachable clients</span>
                  {deliveryMethod === "both" && <span> · {deliveryCounts.deliveries} total deliveries</span>}
                  <span> · {deliveryCounts.emailDeliveries} email · {deliveryCounts.textDeliveries} text</span>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:p-5">
                <div className="rounded-xl border border-slate-300 bg-white shadow-sm">
                  {includesEmail && (
                    <div className="border-b border-slate-200 p-4">
                      <label>
                        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Email Subject</span>
                        <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} placeholder="Your offer or announcement" className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-500" />
                      </label>
                    </div>
                  )}
                  <div className="p-4">
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Ad Message</span>
                      <textarea
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        onPaste={handlePaste}
                        rows={10}
                        placeholder="Write the ad here. You can also paste an image directly into this box."
                        className="w-full resize-y rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-slate-500"
                      />
                    </label>
                    <p className="mt-2 text-right text-xs text-slate-500">{message.length} characters</p>
                  </div>
                </div>

                <div
                  className="mt-4 rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 text-center"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <p className="text-sm font-bold">Drag and drop images here</p>
                  <p className="mt-1 text-xs text-slate-500">You can also paste an image into the message box. Up to {MAX_IMAGES} images.</p>
                  <label className="mt-3 inline-block cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100">
                    {isProcessingImages ? "Processing..." : "Choose Images"}
                    <input type="file" accept="image/*" multiple disabled={isProcessingImages} onChange={(event) => addImages(event.target.files)} className="sr-only" />
                  </label>
                </div>

                {imageError && <p className="mt-3 text-sm font-semibold text-amber-700">{imageError}</p>}
                {images.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {images.map((image) => (
                      <div key={image.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <img src={image.dataUrl} alt={image.name} className="h-36 w-full object-cover" />
                        <div className="flex items-center justify-between gap-3 p-3">
                          <p className="min-w-0 truncate text-xs font-semibold">{image.name}</p>
                          <button type="button" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} className="text-xs font-bold text-red-600 hover:underline">Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-lg font-bold">Repeat This Ad?</h3>
                <div className="mt-3 flex flex-wrap gap-3">
                  <label className={!repeatAd ? "flex cursor-pointer items-center gap-2 rounded-xl border-2 border-slate-950 bg-slate-50 px-4 py-3" : "flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-4 py-3"}>
                    <input type="radio" name="repeatAd" checked={!repeatAd} onChange={() => setRepeatAd(false)} />
                    <span className="text-sm font-bold">No</span>
                  </label>
                  <label className={repeatAd ? "flex cursor-pointer items-center gap-2 rounded-xl border-2 border-slate-950 bg-slate-50 px-4 py-3" : "flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-4 py-3"}>
                    <input type="radio" name="repeatAd" checked={repeatAd} onChange={() => setRepeatAd(true)} />
                    <span className="text-sm font-bold">Yes</span>
                  </label>
                </div>

                {repeatAd && (
                  <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Repeat Every</span>
                      <select value={repeatCadence} onChange={(event) => setRepeatCadence(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
                        {cadenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">First Send</span>
                      <input type="datetime-local" value={firstSendAt} onChange={(event) => setFirstSendAt(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3" />
                    </label>
                  </div>
                )}
              </section>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                Usage charges may apply.
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 p-5 sm:flex-row sm:justify-end md:p-7">
              <button type="button" onClick={closeComposer} disabled={isStartingAd} className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold hover:bg-slate-100 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isStartingAd || isProcessingImages} className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">
                {isStartingAd ? "Starting Ad..." : "Start Ad"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
