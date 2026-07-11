"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

const DEFAULT_CLIENT_ID = "tabor-painting";
const editableFields = [
  { key: "Name", label: "Name" },
  { key: "Phone", label: "Phone" },
  { key: "Email", label: "Email" },
  { key: "Address", label: "Address" },
  { key: "Job", label: "Job" },
  { key: "PreferredDay", label: "Preferred Day" },
  { key: "PreferredTime", label: "Preferred Time" },
  { key: "WorkStartDate", label: "Work Start Date" },
  { key: "Notes", label: "Notes", multiline: true },
];
const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Review My Clients", href: "/review-my-clients" },
  { label: "Contacted Me", href: "/contacted-me" },
  { label: "Pre Clients", href: "/pre-clients" },
  { label: "Clients", href: "/clients" },
  { label: "Post Clients", href: "/post-clients" },
];
const blankRow = Object.fromEntries(editableFields.map(({ key }) => [key, ""]));

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
    isEditing: false,
  };
}

function hasRowData(row) {
  return editableFields.some(({ key }) => String(row[key] || "").trim() !== "");
}

function rowTime(row) {
  if (row.createdAt?.toMillis) return row.createdAt.toMillis();
  if (row.createdAt?.seconds) return row.createdAt.seconds * 1000;
  return 0;
}

function displayTimestamp(value) {
  if (value?.toDate) return value.toDate().toLocaleString();
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString();
  return "";
}

export default function OcmSheet({ title, sectionKey }) {
  const pathname = usePathname();
  const canAddRows = sectionKey === "contactedMe";
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [rows, setRows] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(cleanClientId(params.get("clientId")));
  }, []);

  const rowsCollection = useMemo(
    () => collection(db, "ocmClients", clientId, sectionKey),
    [clientId, sectionKey]
  );

  useEffect(() => {
    setIsLoading(true);
    setError("");

    const unsubscribe = onSnapshot(
      rowsCollection,
      (snapshot) => {
        const firestoreRows = snapshot.docs
          .map((document) => normalizeRow(document.id, document.data()))
          .sort((a, b) => rowTime(a) - rowTime(b));
        setRows(firestoreRows);
        setIsLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load Firestore rows. Check Firebase env variables and Firestore rules.");
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [rowsCollection]);

  function addRow() {
    if (!canAddRows) return;
    const id = `new-row-${Date.now()}`;
    setRows((currentRows) => [...currentRows, { ...blankRow, id, isEditing: true }]);
    setExpandedRows((current) => new Set(current).add(id));
  }

  function updateCell(index, field, value) {
    setRows((currentRows) => currentRows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  }

  function toggleView(id) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function editRow(index) {
    const row = rows[index];
    setRows((currentRows) => currentRows.map((item, rowIndex) => (
      rowIndex === index ? { ...item, isEditing: true } : item
    )));
    setExpandedRows((current) => new Set(current).add(row.id));
  }

  async function saveRow(index) {
    const row = rows[index];
    if (!hasRowData(row)) return;

    const rowData = Object.fromEntries(editableFields.map(({ key }) => [key, row[key] || ""]));
    rowData.source = row.source || "manual";
    rowData.updatedAt = serverTimestamp();

    try {
      if (String(row.id).startsWith("new-row")) {
        await addDoc(rowsCollection, { ...rowData, createdAt: serverTimestamp() });
        setRows((currentRows) => currentRows.filter((_, rowIndex) => rowIndex !== index));
      } else {
        await setDoc(doc(db, "ocmClients", clientId, sectionKey, row.id), rowData, { merge: true });
        setRows((currentRows) => currentRows.map((item, rowIndex) => (
          rowIndex === index ? { ...item, isEditing: false } : item
        )));
      }
    } catch (saveError) {
      console.error(saveError);
      setError("Could not save this client.");
    }
  }

  function cancelEdit(index) {
    const row = rows[index];
    if (String(row.id).startsWith("new-row")) {
      setRows((currentRows) => currentRows.filter((_, rowIndex) => rowIndex !== index));
      return;
    }
    setRows((currentRows) => currentRows.map((item, rowIndex) => (
      rowIndex === index ? { ...item, isEditing: false } : item
    )));
  }

  async function removeRow(index) {
    const row = rows[index];
    const confirmed = window.confirm(`Delete ${row.Name || "this client"}? This cannot be undone.`);
    if (!confirmed) return;

    if (String(row.id).startsWith("new-row")) {
      setRows((currentRows) => currentRows.filter((_, rowIndex) => rowIndex !== index));
      return;
    }

    try {
      await deleteDoc(doc(db, "ocmClients", clientId, sectionKey, row.id));
    } catch (deleteError) {
      console.error(deleteError);
      setError("Could not delete this client.");
    }
  }

  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      const text = search.trim().toLowerCase();
      if (!text) return true;
      return editableFields.some(({ key }) => String(row[key] || "").toLowerCase().includes(text));
    });

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-8 overflow-x-auto pb-2">
          <div className="flex min-w-max justify-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={`${item.href}?clientId=${clientId}`}
                className={pathname === item.href
                  ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">{clientId}</p>
            <h1 className="mt-1 text-4xl font-bold">{title}</h1>
            <p className="mt-2 text-sm text-slate-600">Compact list. Open View to see the complete client profile.</p>
          </div>
          {canAddRows && (
            <button onClick={addRow} className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              + Add New
            </button>
          )}
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search every client field..."
            className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="space-y-3">
          {isLoading && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading clients...</div>}

          {!isLoading && filteredRows.map(({ row, originalIndex }) => {
            const expanded = expandedRows.has(row.id) || row.isEditing;
            return (
              <article key={row.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-slate-950">{row.Name || "Unnamed client"}</h2>
                    <p className="mt-1 text-sm font-medium text-slate-600">{row.Phone || "No phone number"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => toggleView(row.id)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100">
                      {expanded && !row.isEditing ? "Close" : "View"}
                    </button>
                    <button onClick={() => editRow(originalIndex)} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Edit</button>
                    <button onClick={() => removeRow(originalIndex)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Delete</button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-200 bg-slate-50 p-4 md:p-6">
                    {row.isEditing ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        {editableFields.map(({ key, label, multiline }) => (
                          <label key={key} className={multiline ? "md:col-span-2" : ""}>
                            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
                            {multiline ? (
                              <textarea
                                value={row[key] || ""}
                                rows={5}
                                onChange={(event) => updateCell(originalIndex, key, event.target.value)}
                                className="min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none focus:border-slate-500"
                              />
                            ) : (
                              <input
                                value={row[key] || ""}
                                onChange={(event) => updateCell(originalIndex, key, event.target.value)}
                                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-500"
                              />
                            )}
                          </label>
                        ))}
                        <div className="flex gap-2 md:col-span-2">
                          <button onClick={() => saveRow(originalIndex)} disabled={!hasRowData(row)} className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-slate-300">Save</button>
                          <button onClick={() => cancelEdit(originalIndex)} className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-semibold hover:bg-white">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {editableFields.map(({ key, label, multiline }) => (
                          <div key={key} className={multiline ? "md:col-span-2" : ""}>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{row[key] || "—"}</p>
                          </div>
                        ))}
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Source</p>
                          <p className="mt-1 text-sm text-slate-800">{row.source || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Created</p>
                          <p className="mt-1 text-sm text-slate-800">{displayTimestamp(row.createdAt) || "—"}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {!isLoading && filteredRows.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">No clients found.</div>
          )}
        </div>
      </div>
    </main>
  );
}
