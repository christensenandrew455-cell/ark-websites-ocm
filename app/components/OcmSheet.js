"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

const columns = ["Name", "Phone", "Email", "Address", "Job", "Notes"];
const navItems = [
  { label: "Post Clients", href: "/post-clients" },
  { label: "Clients", href: "/clients" },
  { label: "Pre Clients", href: "/pre-clients" },
];
const blankRow = { Name: "", Phone: "", Email: "", Address: "", Job: "", Notes: "", isEditing: true };

function cleanClientId(value) {
  return String(value || "demo-business").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "demo-business";
}

function normalizeRow(id, data) {
  return {
    ...blankRow,
    ...data,
    id,
    Name: data.Name || data.name || data.fullName || "",
    Phone: data.Phone || data.phone || data.phoneNumber || data.contact || "",
    Email: data.Email || data.email || "",
    Address: data.Address || data.address || "",
    Job: data.Job || data.job || data.service || data.projectType || "",
    Notes: data.Notes || data.notes || data.message || "",
    isEditing: false,
  };
}

function hasRowData(row) {
  return columns.some((column) => String(row[column] || "").trim() !== "");
}

function rowTime(row) {
  if (row.createdAt?.toMillis) return row.createdAt.toMillis();
  if (row.createdAt?.seconds) return row.createdAt.seconds * 1000;
  return 0;
}

export default function OcmSheet({ title, sectionKey }) {
  const pathname = usePathname();
  const [clientId, setClientId] = useState("demo-business");
  const [rows, setRows] = useState([{ ...blankRow, id: "new-row" }]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setClientId(cleanClientId(params.get("clientId")));
  }, []);

  const rowsCollection = useMemo(() => collection(db, "ocmClients", clientId, sectionKey), [clientId, sectionKey]);

  useEffect(() => {
    setIsLoading(true);
    setError("");

    const unsubscribe = onSnapshot(
      rowsCollection,
      (snapshot) => {
        const firestoreRows = snapshot.docs
          .map((document) => normalizeRow(document.id, document.data()))
          .sort((a, b) => rowTime(a) - rowTime(b));

        setRows(firestoreRows.length ? firestoreRows : [{ ...blankRow, id: "new-row" }]);
        setIsLoading(false);
      },
      (err) => {
        console.error(err);
        setError("Could not load Firestore rows. Check Firebase env variables and Firestore rules.");
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [rowsCollection]);

  function addRow() {
    setRows((currentRows) => [...currentRows, { ...blankRow, id: `new-row-${Date.now()}` }]);
  }

  function updateCell(index, column, value) {
    setRows((currentRows) => currentRows.map((row, rowIndex) => rowIndex === index ? { ...row, [column]: value } : row));
  }

  function editRow(index) {
    setRows((currentRows) => currentRows.map((row, rowIndex) => rowIndex === index ? { ...row, isEditing: true } : row));
  }

  async function saveRow(index) {
    const row = rows[index];
    if (!hasRowData(row)) return;

    const rowData = {
      Name: row.Name || "",
      Phone: row.Phone || "",
      Email: row.Email || "",
      Address: row.Address || "",
      Job: row.Job || "",
      Notes: row.Notes || "",
      source: row.source || "manual",
      updatedAt: serverTimestamp(),
    };

    try {
      if (String(row.id).startsWith("new-row")) {
        await addDoc(rowsCollection, { ...rowData, createdAt: serverTimestamp() });
      } else {
        await setDoc(doc(db, "ocmClients", clientId, sectionKey, row.id), rowData, { merge: true });
      }
    } catch (err) {
      console.error(err);
      setError("Could not save this row to Firestore.");
    }
  }

  async function removeRow(index) {
    const row = rows[index];
    if (String(row.id).startsWith("new-row")) {
      setRows((currentRows) => currentRows.filter((_, rowIndex) => rowIndex !== index));
      return;
    }

    try {
      await deleteDoc(doc(db, "ocmClients", clientId, sectionKey, row.id));
    } catch (err) {
      console.error(err);
      setError("Could not delete this row from Firestore.");
    }
  }

  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      const text = search.trim().toLowerCase();
      if (!text) return true;
      return columns.some((column) => String(row[column] || "").toLowerCase().includes(text));
    });

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-8 flex justify-center">
          <div className="flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            {navItems.map((item) => (
              <Link key={item.href} href={`${item.href}?clientId=${clientId}`} className={pathname === item.href ? "rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white" : "rounded-full px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Current business/client ID</p>
          <p className="mt-1 font-mono text-sm text-slate-800">{clientId}</p>
          <p className="mt-2 text-xs text-slate-500">Webhook submissions for this business become rows below.</p>
        </div>

        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-4xl font-bold">{title}</h1>
          <button onClick={addRow} className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">+ Add New</button>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, email, job, address, or notes..." className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="w-20 border border-slate-200 px-4 py-3 text-center">#</th>
                  {columns.map((column) => <th key={column} className="border border-slate-200 px-4 py-3">{column}</th>)}
                  <th className="w-48 border border-slate-200 px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={columns.length + 2} className="border border-slate-200 px-4 py-8 text-center text-slate-500">Loading Firestore rows...</td></tr>}
                {!isLoading && filteredRows.map(({ row, originalIndex }) => (
                  <tr key={row.id || originalIndex}>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-center font-semibold text-slate-500">{originalIndex + 1}</td>
                    {columns.map((column) => (
                      <td key={column} className="border border-slate-200 p-0">
                        <input value={row[column] || ""} disabled={!row.isEditing} onChange={(e) => updateCell(originalIndex, column, e.target.value)} className="h-12 w-full bg-white px-4 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-700 focus:bg-slate-50" />
                      </td>
                    ))}
                    <td className="border border-slate-200 px-3 py-2 text-center">
                      <div className="flex justify-center gap-2">
                        {row.isEditing ? <button onClick={() => saveRow(originalIndex)} disabled={!hasRowData(row)} className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300">Save</button> : <button onClick={() => editRow(originalIndex)} className="rounded-md bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">Edit</button>}
                        <button onClick={() => removeRow(originalIndex)} className="rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && filteredRows.length === 0 && <tr><td colSpan={columns.length + 2} className="border border-slate-200 px-4 py-8 text-center text-slate-500">No matching rows found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
