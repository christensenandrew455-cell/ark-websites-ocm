"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";

const utilityNavItems = [
  { label: "Review My Clients", href: "/review-my-clients" },
  { label: "Advertising", href: "/advertising" },
  { label: "Settings", href: "/settings" },
  { label: "Dashboard", href: "/" },
];

const stageConfigs = [
  {
    key: "contactedMe",
    title: "Contacted Me",
    question: "Would you like to take this job?",
    description: "Accept the lead to move it into Pre Clients.",
  },
  {
    key: "preClients",
    title: "Pre Clients",
    question: "Has the estimate been completed?",
    description: "Set the agreed work date to move the customer into Clients.",
  },
  {
    key: "clients",
    title: "Clients",
    question: "Has the work been completed?",
    description: "Completed jobs move into Post Clients.",
  },
  {
    key: "postClients",
    title: "Post Clients",
    question: "Completed clients",
    description: "Use these customers for follow-up, reviews, referrals, and future marketing.",
  },
];

const editableFields = [
  { key: "Name", label: "Name" },
  { key: "Phone", label: "Phone", type: "tel" },
  { key: "Email", label: "Email", type: "email" },
  { key: "Address", label: "Address" },
  { key: "Job", label: "Job" },
  { key: "BestContactMethod", label: "Best Form of Contact", options: ["Text", "Call", "Email"] },
  { key: "PreferredDay", label: "Preferred Day" },
  { key: "PreferredTime", label: "Preferred Time", type: "time" },
  { key: "EstimateDate", label: "Estimate Date", type: "date", estimateOnly: true },
  { key: "EstimateTime", label: "Estimate Time", type: "time", estimateOnly: true },
  { key: "WorkStartDate", label: "Work Start Date", type: "date" },
  { key: "Notes", label: "Notes", multiline: true },
  { key: "source", label: "Source" },
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

function normalizeRow(id, data) {
  return {
    ...data,
    id,
    Name: data.Name || data.name || data.fullName || "",
    Phone: data.Phone || data.phone || data.phoneNumber || data.contact || "",
    Email: data.Email || data.email || "",
    Address: data.Address || data.address || "",
    Job: data.Job || data.job || data.service || data.projectType || "",
    BestContactMethod: normalizeContactMethod(
      data.BestContactMethod || data.bestContactMethod || data.BestFormOfContact || data.bestFormOfContact || data.BestWayToContact || data.bestWayToContact || data.preferredContactMethod || data.contactMethod
    ),
    PreferredDay: data.PreferredDay || data.preferredDay || data.estimateDay || "",
    PreferredTime: data.PreferredTime || data.preferredTime || data.estimateTime || "",
    EstimateDate: data.EstimateDate || "",
    EstimateTime: data.EstimateTime || "",
    WorkStartDate: data.WorkStartDate || data.workStartDate || "",
    Notes: data.Notes || data.notes || data.message || "",
    source: data.source || data.Source || "",
  };
}

function rowTime(row) {
  if (row.createdAt?.toMillis) return row.createdAt.toMillis();
  if (row.createdAt?.seconds) return row.createdAt.seconds * 1000;
  return 0;
}

function clientData(row) {
  const { id, ...data } = row;
  return data;
}

function clientMatches(row, search) {
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;
  return editableFields.some(({ key }) => String(row[key] || "").toLowerCase().includes(term));
}

function fieldsForStage(stageKey) {
  if (stageKey === "clients" || stageKey === "postClients") {
    return editableFields.filter((field) => !field.estimateOnly);
  }
  return editableFields;
}

function NavLink({ item, clientId, active = false }) {
  return (
    <Link
      href={`${item.href}?clientId=${clientId}`}
      className={active
        ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}
    >
      {item.label}
    </Link>
  );
}

function Dialog({ title, children, onClose, closeDisabled = false, maxWidth = "max-w-3xl" }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !closeDisabled) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="fixed inset-0 cursor-default" onClick={closeDisabled ? undefined : onClose} aria-label="Close dialog" />
      <div className={`relative mx-auto my-8 ${maxWidth} overflow-hidden rounded-3xl bg-white shadow-2xl`}>
        {children}
      </div>
    </div>
  );
}

export default function ReviewClients() {
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [rowsByStage, setRowsByStage] = useState({ contactedMe: [], preClients: [], clients: [], postClients: [] });
  const [loadedStages, setLoadedStages] = useState(new Set());
  const [openStages, setOpenStages] = useState(new Set());
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [searchByStage, setSearchByStage] = useState({ contactedMe: "", preClients: "", clients: "", postClients: "" });
  const [startDates, setStartDates] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [busyRows, setBusyRows] = useState(new Set());
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(cleanClientId(params.get("clientId")));
  }, []);

  const collections = useMemo(() => Object.fromEntries(
    stageConfigs.map((stage) => [stage.key, collection(db, "ocmClients", clientId, stage.key)])
  ), [clientId]);

  useEffect(() => {
    setLoadedStages(new Set());
    setError("");

    const unsubscribers = stageConfigs.map((stage) => onSnapshot(
      collections[stage.key],
      (snapshot) => {
        const rows = snapshot.docs
          .map((document) => normalizeRow(document.id, document.data()))
          .sort((a, b) => rowTime(a) - rowTime(b));
        setRowsByStage((current) => ({ ...current, [stage.key]: rows }));
        setStartDates((current) => {
          const next = { ...current };
          rows.forEach((row) => {
            if (row.WorkStartDate && !next[row.id]) next[row.id] = row.WorkStartDate;
          });
          return next;
        });
        setLoadedStages((current) => new Set(current).add(stage.key));
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load the review lists. Check Firebase settings and permissions.");
      }
    ));

    const unsubscribeNotifications = onSnapshot(
      collection(db, "ocmClients", clientId, "notifications"),
      (snapshot) => {
        setNotifications(snapshot.docs
          .map((document) => ({ id: document.id, ...document.data() }))
          .filter((notification) => !notification.dismissed)
          .sort((a, b) => String(b.dateKey || "").localeCompare(String(a.dateKey || ""))));
      }
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeNotifications();
    };
  }, [collections, clientId]);

  function setBusy(key, busy) {
    setBusyRows((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleStage(stageKey) {
    setOpenStages((current) => {
      const next = new Set(current);
      if (next.has(stageKey)) next.delete(stageKey);
      else next.add(stageKey);
      return next;
    });
  }

  function toggleView(stageKey, id) {
    const key = `${stageKey}:${id}`;
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openEdit(stageKey, row) {
    const draft = Object.fromEntries(editableFields.map(({ key }) => [key, row[key] || ""]));
    setError("");
    setNotice("");
    setEditTarget({ stageKey, row, draft });
  }

  function updateEditField(key, value) {
    setEditTarget((current) => current ? { ...current, draft: { ...current.draft, [key]: value } } : current);
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editTarget) return;

    const busyKey = `${editTarget.stageKey}:${editTarget.row.id}`;
    setBusy(busyKey, true);
    setError("");

    try {
      const payload = {
        ...editTarget.draft,
        BestContactMethod: normalizeContactMethod(editTarget.draft.BestContactMethod),
        updatedAt: serverTimestamp(),
      };

      if (editTarget.stageKey === "clients" || editTarget.stageKey === "postClients") {
        payload.EstimateDate = deleteField();
        payload.EstimateTime = deleteField();
      }

      await setDoc(doc(db, "ocmClients", clientId, editTarget.stageKey, editTarget.row.id), payload, { merge: true });
      setNotice(`${editTarget.draft.Name || "Client"} was updated.`);
      setEditTarget(null);
    } catch (saveError) {
      console.error(saveError);
      setError(`Could not update ${editTarget.row.Name || "this client"}.`);
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function acceptLead(row) {
    const busyKey = `contactedMe:${row.id}`;
    if (busyRows.has(busyKey)) return;
    setBusy(busyKey, true);
    setError("");

    try {
      const response = await fetch("/api/workflow/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, id: row.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not accept this lead.");
      setNotice(`${row.Name || "Lead"} moved to Pre Clients.`);
    } catch (acceptError) {
      console.error(acceptError);
      setError(acceptError.message || `Could not accept ${row.Name || "this lead"}.`);
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function moveClient(fromStage, toStage, row, extra = {}) {
    const busyKey = `${fromStage}:${row.id}`;
    if (busyRows.has(busyKey)) return;
    setBusy(busyKey, true);
    setError("");

    try {
      const data = clientData(row);
      if (toStage === "clients" || toStage === "postClients") {
        delete data.EstimateDate;
        delete data.EstimateTime;
      }

      const batch = writeBatch(db);
      const sourceRef = doc(db, "ocmClients", clientId, fromStage, row.id);
      const targetRef = doc(db, "ocmClients", clientId, toStage, row.id);
      batch.set(targetRef, {
        ...data,
        ...extra,
        currentStage: toStage,
        previousStage: fromStage,
        movedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.delete(sourceRef);
      await batch.commit();
      setNotice(`${row.Name || "Client"} moved successfully.`);
    } catch (moveError) {
      console.error(moveError);
      setError(`Could not move ${row.Name || "this client"}.`);
    } finally {
      setBusy(busyKey, false);
    }
  }

  function requestDelete(stageKey, row) {
    setError("");
    setNotice("");
    setDeleteTarget({ stageKey, row });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { stageKey, row } = deleteTarget;
    const busyKey = `${stageKey}:${row.id}`;
    if (busyRows.has(busyKey)) return;

    setBusy(busyKey, true);
    try {
      await deleteDoc(doc(db, "ocmClients", clientId, stageKey, row.id));
      setNotice(`${row.Name || "Client"} was deleted.`);
      setDeleteTarget(null);
    } catch (deleteError) {
      console.error(deleteError);
      setError(`Could not delete ${row.Name || "this client"}.`);
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function saveStartDate(row) {
    const date = startDates[row.id] || "";
    if (!date) {
      setError("Choose a work start date first.");
      return;
    }

    const busyKey = `preClients:${row.id}`;
    if (busyRows.has(busyKey)) return;
    setBusy(busyKey, true);
    setError("");

    try {
      const data = clientData(row);
      delete data.EstimateDate;
      delete data.EstimateTime;
      delete data.EstimateFollowUpDue;

      const batch = writeBatch(db);
      batch.set(doc(db, "ocmClients", clientId, "clients", row.id), {
        ...data,
        WorkStartDate: date,
        estimateCompleted: true,
        estimateCompletedAt: serverTimestamp(),
        workCompleted: false,
        currentStage: "clients",
        previousStage: "preClients",
        movedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.delete(doc(db, "ocmClients", clientId, "preClients", row.id));
      await batch.commit();
      setNotice(`${row.Name || "Client"} moved to Clients with a work date of ${date}.`);
    } catch (saveError) {
      console.error(saveError);
      setError(`Could not set the start date for ${row.Name || "this client"}.`);
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function markNotCompleted(row) {
    const busyKey = `clients:${row.id}`;
    if (busyRows.has(busyKey)) return;
    setBusy(busyKey, true);

    try {
      await setDoc(doc(db, "ocmClients", clientId, "clients", row.id), {
        lastCompletionReview: serverTimestamp(),
        workCompleted: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setNotice(`${row.Name || "Client"} remains in Clients.`);
    } catch (reviewError) {
      console.error(reviewError);
      setError(`Could not update ${row.Name || "this client"}.`);
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function dismissNotification(notification) {
    await setDoc(doc(db, "ocmClients", clientId, "notifications", notification.id), {
      dismissed: true,
      dismissedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  function renderActions(stageKey, row) {
    const busy = busyRows.has(`${stageKey}:${row.id}`);

    if (stageKey === "contactedMe") {
      return (
        <>
          <button disabled={busy} onClick={() => acceptLead(row)} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-slate-300">Accept Lead</button>
          <button disabled={busy} onClick={() => requestDelete("contactedMe", row)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300">Decline & Delete</button>
        </>
      );
    }

    if (stageKey === "preClients") {
      return (
        <>
          <input
            type="date"
            value={startDates[row.id] || ""}
            onChange={(event) => setStartDates((current) => ({ ...current, [row.id]: event.target.value }))}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            aria-label={`Work start date for ${row.Name || "client"}`}
          />
          <button disabled={busy} onClick={() => saveStartDate(row)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300">Save Date & Move to Clients</button>
          <button disabled={busy} onClick={() => moveClient("preClients", "contactedMe", row)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Move Back</button>
          <button disabled={busy} onClick={() => requestDelete("preClients", row)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300">Delete</button>
        </>
      );
    }

    if (stageKey === "clients") {
      return (
        <>
          <button disabled={busy} onClick={() => moveClient("clients", "postClients", row, { workCompleted: true, completedAt: serverTimestamp() })} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-slate-300">Work Completed</button>
          <button disabled={busy} onClick={() => markNotCompleted(row)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Not Yet</button>
          <button disabled={busy} onClick={() => moveClient("clients", "preClients", row)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Move Back</button>
          <button disabled={busy} onClick={() => requestDelete("clients", row)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300">Delete</button>
        </>
      );
    }

    return (
      <>
        <button disabled={busy} onClick={() => moveClient("postClients", "clients", row, { workCompleted: false })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Move Back to Clients</button>
        <button disabled={busy} onClick={() => requestDelete("postClients", row)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300">Delete</button>
      </>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 overflow-x-auto pb-2">
          <div className="flex min-w-max items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {utilityNavItems.map((item) => <NavLink key={item.href} item={item} clientId={clientId} active={item.href === "/review-my-clients"} />)}
          </div>
        </nav>

        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{clientId}</p>
          <h1 className="mt-1 text-4xl font-bold">Review My Clients</h1>
          <p className="mt-2 max-w-3xl text-slate-600">Search, edit, review, and move every client from one compact workspace.</p>
        </div>

        {notifications.map((notification) => (
          <div key={notification.id} className="mb-5 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold text-blue-950">{notification.title || "Daily review"}</p>
              <p className="mt-1 text-sm text-blue-800">{notification.message || "Go review your clients."}</p>
            </div>
            <button onClick={() => dismissNotification(notification)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">Dismiss</button>
          </div>
        ))}

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {notice && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">{notice}</div>}

        <div className="space-y-4">
          {stageConfigs.map((stage) => {
            const rows = rowsByStage[stage.key] || [];
            const loaded = loadedStages.has(stage.key);
            const isOpen = openStages.has(stage.key);
            const search = searchByStage[stage.key] || "";
            const filteredRows = rows.filter((row) => clientMatches(row, search));

            return (
              <section key={stage.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleStage(stage.key)}
                  className="flex w-full items-center justify-between gap-4 bg-slate-950 px-5 py-4 text-left text-white hover:bg-slate-900"
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold">{stage.title}</h2>
                    <p className="mt-0.5 truncate text-sm text-slate-300">{stage.question}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold">{rows.length}</span>
                    <span className="text-xl" aria-hidden="true">{isOpen ? "−" : "+"}</span>
                  </div>
                </button>

                {isOpen && (
                  <div>
                    <div className="border-b border-slate-200 bg-slate-50 p-4">
                      <p className="mb-3 text-sm text-slate-600">{stage.description}</p>
                      <label>
                        <span className="sr-only">Search {stage.title}</span>
                        <input
                          value={search}
                          onChange={(event) => setSearchByStage((current) => ({ ...current, [stage.key]: event.target.value }))}
                          placeholder={`Search ${stage.title.toLowerCase()} by name, phone, email, job, address, or notes...`}
                          className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        />
                      </label>
                      {search && <p className="mt-2 text-xs font-semibold text-slate-500">{filteredRows.length} of {rows.length} clients shown</p>}
                    </div>

                    <div className="max-h-[34rem] divide-y divide-slate-200 overflow-y-auto">
                      {!loaded && <div className="p-6 text-center text-slate-500">Loading...</div>}
                      {loaded && rows.length === 0 && <div className="p-6 text-center text-slate-500">No clients in this stage.</div>}
                      {loaded && rows.length > 0 && filteredRows.length === 0 && <div className="p-6 text-center text-slate-500">No clients match that search.</div>}

                      {loaded && filteredRows.map((row) => {
                        const expanded = expandedRows.has(`${stage.key}:${row.id}`);
                        const busy = busyRows.has(`${stage.key}:${row.id}`);
                        const profileFields = fieldsForStage(stage.key);

                        return (
                          <article key={row.id}>
                            {stage.key === "preClients" && row.EstimateFollowUpDue && !row.WorkStartDate && (
                              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900">Estimate passed. Add the agreed work start date.</div>
                            )}
                            <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                              <h3 className="min-w-0 truncate font-bold">{row.Name || "Unnamed client"}</h3>
                              <div className="flex shrink-0 items-center gap-2">
                                <button type="button" onClick={() => toggleView(stage.key, row.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100">{expanded ? "Close" : "View"}</button>
                                <button type="button" onClick={() => openEdit(stage.key, row)} disabled={busy} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:bg-slate-400">Edit</button>
                              </div>
                            </div>

                            {expanded && (
                              <div className="border-t border-slate-200 bg-slate-50 p-4 md:p-5">
                                <div className="grid gap-4 md:grid-cols-2">
                                  {profileFields.map(({ key, label }) => (
                                    <div key={key} className={key === "Notes" ? "md:col-span-2" : ""}>
                                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{row[key] || "—"}</p>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                                  {renderActions(stage.key, row)}
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {editTarget && (
        <Dialog title={`Edit ${editTarget.row.Name || "client"}`} onClose={() => setEditTarget(null)} closeDisabled={busyRows.has(`${editTarget.stageKey}:${editTarget.row.id}`)}>
          <form onSubmit={saveEdit}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 md:p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{stageConfigs.find((stage) => stage.key === editTarget.stageKey)?.title}</p>
                <h2 className="mt-1 text-2xl font-bold">Edit Client</h2>
              </div>
              <button type="button" onClick={() => setEditTarget(null)} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-2 md:p-6">
              {fieldsForStage(editTarget.stageKey).map((field) => (
                <label key={field.key} className={field.multiline ? "md:col-span-2" : ""}>
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{field.label}</span>
                  {field.multiline ? (
                    <textarea value={editTarget.draft[field.key]} onChange={(event) => updateEditField(field.key, event.target.value)} rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-slate-500" />
                  ) : field.options ? (
                    <select value={editTarget.draft[field.key]} onChange={(event) => updateEditField(field.key, event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-500">
                      <option value="">Select...</option>
                      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input type={field.type || "text"} value={editTarget.draft[field.key]} onChange={(event) => updateEditField(field.key, event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-slate-500" />
                  )}
                </label>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 p-5 sm:flex-row sm:justify-end md:p-6">
              <button type="button" onClick={() => setEditTarget(null)} className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold hover:bg-slate-100">Cancel</button>
              <button type="submit" disabled={busyRows.has(`${editTarget.stageKey}:${editTarget.row.id}`)} className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-400">Save Changes</button>
            </div>
          </form>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog title={`Delete ${deleteTarget.row.Name || "client"}`} onClose={() => setDeleteTarget(null)} closeDisabled={busyRows.has(`${deleteTarget.stageKey}:${deleteTarget.row.id}`)} maxWidth="max-w-md">
          <div className="p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-xl font-black text-red-700">!</div>
            <h2 className="mt-4 text-2xl font-bold">Delete {deleteTarget.row.Name || "this client"}?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">This permanently removes the client from the OCM. This cannot be undone.</p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={busyRows.has(`${deleteTarget.stageKey}:${deleteTarget.row.id}`)} className="rounded-lg bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:bg-red-300">{busyRows.has(`${deleteTarget.stageKey}:${deleteTarget.row.id}`) ? "Deleting..." : "Delete Client"}</button>
            </div>
          </div>
        </Dialog>
      )}
    </main>
  );
}
