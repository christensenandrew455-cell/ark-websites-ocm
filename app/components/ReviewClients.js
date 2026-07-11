"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";

const stageConfigs = [
  {
    key: "contactedMe",
    title: "Contacted Me",
    question: "Would you like to take this job?",
    description: "Approve the lead to move it into Pre Clients, or decline it to remove it from this review queue without deleting its information.",
  },
  {
    key: "preClients",
    title: "Pre Clients",
    question: "Has the estimate been completed?",
    description: "After the estimate, enter the agreed work start date. The client moves to Clients automatically when that date arrives, or you can move them now.",
  },
  {
    key: "clients",
    title: "Clients",
    question: "Has the work been completed?",
    description: "Move completed work into Post Clients. Choose Not Yet to leave the client here for the next review.",
  },
  {
    key: "postClients",
    title: "Post Clients",
    question: "Completed clients",
    description: "Use this list for follow-up, reviews, referrals, and future marketing.",
  },
];

const profileFields = [
  ["Name", "Name"],
  ["Phone", "Phone"],
  ["Email", "Email"],
  ["Address", "Address"],
  ["Job", "Job"],
  ["PreferredDay", "Preferred Day"],
  ["PreferredTime", "Preferred Time"],
  ["WorkStartDate", "Work Start Date"],
  ["Notes", "Notes"],
  ["source", "Source"],
];

function cleanClientId(value) {
  return String(value || DEFAULT_CLIENT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || DEFAULT_CLIENT_ID;
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
    PreferredDay: data.PreferredDay || data.preferredDay || data.estimateDay || "",
    PreferredTime: data.PreferredTime || data.preferredTime || data.estimateTime || "",
    WorkStartDate: data.WorkStartDate || data.workStartDate || "",
    Notes: data.Notes || data.notes || data.message || "",
  };
}

function rowTime(row) {
  if (row.createdAt?.toMillis) return row.createdAt.toMillis();
  if (row.createdAt?.seconds) return row.createdAt.seconds * 1000;
  return 0;
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clientData(row) {
  const { id, ...data } = row;
  return data;
}

export default function ReviewClients() {
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [rowsByStage, setRowsByStage] = useState({
    contactedMe: [],
    preClients: [],
    clients: [],
    postClients: [],
  });
  const [loadedStages, setLoadedStages] = useState(new Set());
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [startDates, setStartDates] = useState({});
  const [busyRows, setBusyRows] = useState(new Set());
  const [error, setError] = useState("");

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

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [collections]);

  async function moveClient(fromStage, toStage, row, extra = {}) {
    const busyKey = `${fromStage}:${row.id}`;
    if (busyRows.has(busyKey)) return;

    setBusyRows((current) => new Set(current).add(busyKey));
    setError("");

    try {
      const batch = writeBatch(db);
      const sourceRef = doc(db, "ocmClients", clientId, fromStage, row.id);
      const targetRef = doc(db, "ocmClients", clientId, toStage, row.id);
      batch.set(targetRef, {
        ...clientData(row),
        ...extra,
        currentStage: toStage,
        previousStage: fromStage,
        movedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.delete(sourceRef);
      await batch.commit();
    } catch (moveError) {
      console.error(moveError);
      setError(`Could not move ${row.Name || "this client"}.`);
    } finally {
      setBusyRows((current) => {
        const next = new Set(current);
        next.delete(busyKey);
        return next;
      });
    }
  }

  async function declineLead(row) {
    const busyKey = `contactedMe:${row.id}`;
    if (busyRows.has(busyKey)) return;
    setBusyRows((current) => new Set(current).add(busyKey));

    try {
      await setDoc(doc(db, "ocmClients", clientId, "contactedMe", row.id), {
        reviewStatus: "declined",
        declinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (declineError) {
      console.error(declineError);
      setError(`Could not decline ${row.Name || "this lead"}.`);
    } finally {
      setBusyRows((current) => {
        const next = new Set(current);
        next.delete(busyKey);
        return next;
      });
    }
  }

  async function saveStartDate(row) {
    const date = startDates[row.id] || "";
    if (!date) {
      setError("Choose a work start date first.");
      return;
    }

    try {
      await setDoc(doc(db, "ocmClients", clientId, "preClients", row.id), {
        WorkStartDate: date,
        estimateCompleted: true,
        estimateCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (saveError) {
      console.error(saveError);
      setError(`Could not save the start date for ${row.Name || "this client"}.`);
    }
  }

  async function markNotCompleted(row) {
    try {
      await setDoc(doc(db, "ocmClients", clientId, "clients", row.id), {
        lastCompletionReview: serverTimestamp(),
        workCompleted: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (reviewError) {
      console.error(reviewError);
      setError(`Could not update ${row.Name || "this client"}.`);
    }
  }

  useEffect(() => {
    if (!loadedStages.has("preClients")) return;
    const today = todayIso();
    const dueRows = rowsByStage.preClients.filter((row) => (
      row.WorkStartDate && row.WorkStartDate <= today && row.reviewStatus !== "declined"
    ));

    dueRows.forEach((row) => {
      moveClient("preClients", "clients", row, {
        workStartedAt: serverTimestamp(),
        autoMovedOnStartDate: true,
      });
    });
  }, [loadedStages, rowsByStage.preClients]);

  function toggleView(stageKey, id) {
    const key = `${stageKey}:${id}`;
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function activeRows(stageKey) {
    const rows = rowsByStage[stageKey] || [];
    if (stageKey === "contactedMe") return rows.filter((row) => row.reviewStatus !== "declined");
    return rows;
  }

  function renderActions(stageKey, row) {
    const busy = busyRows.has(`${stageKey}:${row.id}`);

    if (stageKey === "contactedMe") {
      return (
        <>
          <button disabled={busy} onClick={() => moveClient("contactedMe", "preClients", row, { acceptedAt: serverTimestamp(), reviewStatus: "accepted" })} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-slate-300">✓ Accept</button>
          <button disabled={busy} onClick={() => declineLead(row)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300">✕ Decline</button>
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
          <button onClick={() => saveStartDate(row)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Save Start Date</button>
          <button disabled={busy} onClick={() => moveClient("preClients", "clients", row, { workStartedAt: serverTimestamp() })} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-slate-300">Move to Client</button>
          <button disabled={busy} onClick={() => moveClient("preClients", "contactedMe", row)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Move Back</button>
        </>
      );
    }

    if (stageKey === "clients") {
      return (
        <>
          <button disabled={busy} onClick={() => moveClient("clients", "postClients", row, { workCompleted: true, completedAt: serverTimestamp() })} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-slate-300">✓ Completed</button>
          <button disabled={busy} onClick={() => markNotCompleted(row)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Not Yet</button>
          <button disabled={busy} onClick={() => moveClient("clients", "preClients", row)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Move Back</button>
        </>
      );
    }

    return (
      <button disabled={busy} onClick={() => moveClient("postClients", "clients", row, { workCompleted: false })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:text-slate-400">Move Back to Clients</button>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{clientId}</p>
            <h1 className="mt-1 text-4xl font-bold">Review My Clients</h1>
            <p className="mt-2 max-w-3xl text-slate-600">Review each stage in one place. Every move preserves the complete client record.</p>
          </div>
          <Link href={`/?clientId=${clientId}`} className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Back to Dashboard</Link>
        </div>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <div className="space-y-8">
          {stageConfigs.map((stage) => {
            const rows = activeRows(stage.key);
            const loaded = loadedStages.has(stage.key);

            return (
              <section key={stage.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-950 p-5 text-white">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-bold">{stage.title}</h2>
                      <p className="mt-1 text-lg font-semibold text-slate-200">{stage.question}</p>
                      <p className="mt-2 max-w-3xl text-sm text-slate-300">{stage.description}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold">{rows.length}</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-200">
                  {!loaded && <div className="p-6 text-center text-slate-500">Loading...</div>}
                  {loaded && rows.length === 0 && <div className="p-6 text-center text-slate-500">No clients need review in this stage.</div>}

                  {loaded && rows.map((row) => {
                    const expanded = expandedRows.has(`${stage.key}:${row.id}`);
                    return (
                      <article key={row.id}>
                        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <h3 className="truncate text-lg font-bold">{row.Name || "Unnamed client"}</h3>
                            <p className="mt-1 text-sm font-medium text-slate-600">{row.Phone || "No phone number"}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => toggleView(stage.key, row.id)} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">{expanded ? "Close" : "View Profile"}</button>
                            {renderActions(stage.key, row)}
                          </div>
                        </div>

                        {expanded && (
                          <div className="border-t border-slate-200 bg-slate-50 p-5">
                            <div className="grid gap-4 md:grid-cols-2">
                              {profileFields.map(([key, label]) => (
                                <div key={key} className={key === "Notes" ? "md:col-span-2" : ""}>
                                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{row[key] || "—"}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
