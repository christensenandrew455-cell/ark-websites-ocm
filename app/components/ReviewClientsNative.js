"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

const TIME_RANGES = [
  { key: "today", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}
function toMillis(value) {
  if (!value) return 0;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
function normalizeRow(id, data, collectionKey) {
  const jobs = Array.isArray(data.Jobs) ? data.Jobs : [];
  const currentJob = jobs.at(-1) || {};
  return {
    ...data,
    id,
    collectionKey,
    Name: firstValue(data.Name, data.name, data.fullName),
    Phone: firstValue(data.Phone, data.phone, data.phoneNumber, data.contact),
    Email: firstValue(data.Email, data.email),
    Address: firstValue(data.Address, data.address),
    Job: firstValue(data.Job, data.job, data.service, data.projectType, currentJob.type),
    Notes: firstValue(data.Notes, data.notes, data.message, currentJob.notes),
    EstimateDate: firstValue(data.EstimateDate, data.estimateDate, data.PreferredDate, data.preferredDate, data.PreferredDay, data.preferredDay, data.estimateDay, currentJob.estimateDate),
    EstimateTime: firstValue(data.EstimateTime, data.estimateTime, data.PreferredTime, data.preferredTime, currentJob.estimateTime),
  };
}
function rowTime(row) {
  return toMillis(row.updatedAt || row.acceptedAt || row.createdAt);
}
function insideRange(row, range) {
  if (range === "all") return true;
  const value = rowTime(row);
  if (!value) return false;
  const now = new Date();
  const start = range === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return value >= start;
}
function displayDate(row) {
  const raw = firstValue(row.EstimateDate, row.EstimateTime);
  if (!raw) return "Not selected";
  const date = new Date(`${row.EstimateDate || ""}${row.EstimateTime ? `T${row.EstimateTime}` : ""}`);
  if (Number.isNaN(date.getTime())) return [row.EstimateDate, row.EstimateTime].filter(Boolean).join(" · ");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function calendarStamp(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}
function escapeCalendar(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function downloadCalendar(row, businessName) {
  if (!row.EstimateDate) return false;
  const start = new Date(`${row.EstimateDate}T${row.EstimateTime || "09:00"}`);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const contents = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${escapeCalendar(businessName)}//ARK Client Center//EN`, "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${row.id}-${Date.now()}@ark-ocm`, `DTSTAMP:${calendarStamp(new Date())}`, `DTSTART:${calendarStamp(start)}`, `DTEND:${calendarStamp(end)}`,
    `SUMMARY:${escapeCalendar(`Estimate - ${row.Name || row.Address || "Client"}`)}`,
    `DESCRIPTION:${escapeCalendar([row.Job && `Job: ${row.Job}`, row.Phone && `Phone: ${row.Phone}`, row.Notes && `Notes: ${row.Notes}`].filter(Boolean).join("\n"))}`,
    `LOCATION:${escapeCalendar(row.Address)}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${String(row.Name || "client").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-estimate.ics`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const listener = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}><button type="button" className="fixed inset-0" onClick={onClose} aria-label="Close" /><div className="relative mx-auto my-4 max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">{children}</div></div>;
}
function Detail({ label, value, wide = false }) {
  return <div className={wide ? "col-span-2" : ""}><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-900">{value || "—"}</p></div>;
}
function ViewModal({ row, messagesEnabled, onClose, onMessage, onDate }) {
  return <Modal title="Client details" onClose={onClose}><div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Client details</p><h2 className="mt-1 text-2xl font-black">{row.Name || "Unnamed caller"}</h2></div><button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button></div><div className="grid grid-cols-2 gap-4 p-5"><Detail label="Phone" value={row.Phone} /><Detail label="Email" value={row.Email} /><Detail label="Address" value={row.Address} wide /><Detail label="Job type" value={row.Job} /><Detail label="Requested date" value={displayDate(row)} /><Detail label="Notes" value={row.Notes} wide /></div><div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-5">{messagesEnabled && <button type="button" onClick={onMessage} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Message</button>}{row.collectionKey === "clients" && <button type="button" onClick={onDate} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Confirm Date</button>}</div></Modal>;
}
function EditModal({ row, clientId, onClose, onSaved }) {
  const [form, setForm] = useState({ Name: row.Name || "", Phone: row.Phone || "", Email: row.Email || "", Address: row.Address || "", Job: row.Job || "", EstimateDate: /^\d{4}-\d{2}-\d{2}$/.test(String(row.EstimateDate || "")) ? row.EstimateDate : "", EstimateTime: row.EstimateTime || "", Notes: row.Notes || "" });
  const [saving, setSaving] = useState(false);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, "ocmClients", clientId, row.collectionKey, row.id), { ...form, PreferredDate: form.EstimateDate, updatedAt: serverTimestamp() }, { merge: true });
      onSaved();
    } finally {
      setSaving(false);
    }
  }
  return <Modal title="Edit client" onClose={onClose}><form onSubmit={save}><div className="flex items-center justify-between border-b border-slate-200 p-5"><h2 className="text-2xl font-black">Edit client</h2><button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button></div><div className="grid grid-cols-2 gap-3 p-5">{[["Name", "Name", "text"], ["Phone", "Phone", "tel"], ["Email", "Email", "email"], ["Address", "Address", "text"], ["Job", "Job type", "text"], ["EstimateDate", "Estimate date", "date"], ["EstimateTime", "Estimate time", "time"]].map(([field, label, type]) => <label key={field} className={field === "Address" ? "col-span-2" : ""}><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">{label}</span><input type={type} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" /></label>)}<label className="col-span-2"><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Notes</span><textarea rows={3} value={form.Notes} onChange={(event) => setForm((current) => ({ ...current, Notes: event.target.value }))} className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" /></label></div><div className="flex justify-end border-t border-slate-200 p-5"><button disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></div></form></Modal>;
}

export default function ReviewClientsNative() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const clientId = profile?.clientId || "";
  const businessName = profile?.businessName || "Your Business";
  const messagesEnabled = profile?.messagesEnabled === true;
  const [contacted, setContacted] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [range, setRange] = useState("all");
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!clientId) return undefined;
    const unsubContacted = onSnapshot(collection(db, "ocmClients", clientId, "contactedMe"), (snapshot) => setContacted(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "contactedMe")).sort((a, b) => rowTime(b) - rowTime(a))), () => setError("Could not load new leads."));
    const unsubClients = onSnapshot(collection(db, "ocmClients", clientId, "clients"), (snapshot) => setClients(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "clients")).sort((a, b) => rowTime(b) - rowTime(a))), () => setError("Could not load clients."));
    return () => { unsubContacted(); unsubClients(); };
  }, [clientId]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "contacted" || section === "clients") setActiveSection(section);
  }, [searchParams]);

  const rows = activeSection === "contacted" ? contacted : activeSection === "clients" ? clients : [];
  const filteredRows = useMemo(() => rows.filter((row) => insideRange(row, range)), [range, rows]);

  async function accept(row) {
    if (busy) return;
    setBusy(`accept:${row.id}`);
    try {
      const { id, collectionKey, ...data } = row;
      const batch = writeBatch(db);
      batch.set(doc(db, "ocmClients", clientId, "clients", row.id), { ...data, currentStage: "clients", acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      batch.delete(doc(db, "ocmClients", clientId, "contactedMe", row.id));
      await batch.commit();
      setNotice(`${row.Name || "Lead"} was accepted.`);
    } catch {
      setError("Could not accept this lead.");
    } finally {
      setBusy("");
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete ${row.Name || "this record"}?`)) return;
    setBusy(`delete:${row.id}`);
    try {
      await deleteDoc(doc(db, "ocmClients", clientId, row.collectionKey, row.id));
      setNotice(`${row.Name || "Record"} was deleted.`);
      if (viewing?.id === row.id) setViewing(null);
    } catch {
      setError("Could not delete this record.");
    } finally {
      setBusy("");
    }
  }

  function openMessage(row) {
    router.push(`/lead-messages?lead=${encodeURIComponent(row.id)}&collection=${row.collectionKey}`);
  }

  function confirmDate(row) {
    if (!downloadCalendar(row, businessName)) {
      setViewing(null);
      setEditing(row);
      setNotice("Add an estimate date and time, then confirm it again.");
    } else {
      setNotice("Calendar event created. Review it in your calendar app.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-950 sm:px-5 sm:py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}

        <section className="grid grid-cols-2 gap-3 sm:gap-5">
          <button type="button" onClick={() => setActiveSection(activeSection === "contacted" ? null : "contacted")} className={activeSection === "contacted" ? "min-h-36 rounded-3xl bg-slate-950 p-5 text-left text-white" : "min-h-36 rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm"}>
            <p className="text-4xl font-black">{contacted.length}</p><h2 className="mt-2 text-lg font-black">Contacted You</h2><p className="mt-1 text-xs font-semibold opacity-60">New receptionist leads</p>
          </button>
          <button type="button" onClick={() => setActiveSection(activeSection === "clients" ? null : "clients")} className={activeSection === "clients" ? "min-h-36 rounded-3xl bg-slate-950 p-5 text-left text-white" : "min-h-36 rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm"}>
            <p className="text-4xl font-black">{clients.length}</p><h2 className="mt-2 text-lg font-black">Clients</h2><p className="mt-1 text-xs font-semibold opacity-60">Accepted people</p>
          </button>
        </section>

        {activeSection && (
          <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black">{activeSection === "contacted" ? "Contacted You" : "Clients"}</h2><button type="button" onClick={() => setActiveSection(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black">Close</button></div>
            <div className="mt-4 grid grid-cols-3 rounded-xl bg-slate-100 p-1">{TIME_RANGES.map((option) => <button key={option.key} type="button" onClick={() => setRange(option.key)} className={range === option.key ? "rounded-lg bg-white px-2 py-2 text-xs font-black shadow-sm" : "rounded-lg px-2 py-2 text-xs font-bold text-slate-500"}>{option.label}</button>)}</div>
            <div className="mt-4 space-y-3">
              {filteredRows.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 p-4"><button type="button" onClick={() => setViewing(row)} className="w-full text-left"><h3 className="truncate text-base font-black">{row.Name || "Unnamed person"}</h3><p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p></button><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{activeSection === "contacted" && <button type="button" disabled={Boolean(busy)} onClick={() => accept(row)} className="rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Accept</button>}<button type="button" onClick={() => setViewing(row)} className="rounded-xl border border-slate-300 px-3 py-3 text-xs font-black">View</button>{messagesEnabled && <button type="button" onClick={() => openMessage(row)} className="rounded-xl bg-slate-950 px-3 py-3 text-xs font-black text-white">Message</button>}{activeSection === "clients" && <button type="button" onClick={() => setEditing(row)} className="rounded-xl border border-slate-300 px-3 py-3 text-xs font-black">Edit</button>}<button type="button" disabled={Boolean(busy)} onClick={() => remove(row)} className="rounded-xl border border-red-300 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div></article>)}
              {filteredRows.length === 0 && <p className="rounded-2xl bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">Nothing here for this time range.</p>}
            </div>
          </section>
        )}
      </div>
      {viewing && <ViewModal row={viewing} messagesEnabled={messagesEnabled} onClose={() => setViewing(null)} onMessage={() => openMessage(viewing)} onDate={() => confirmDate(viewing)} />}
      {editing && <EditModal row={editing} clientId={clientId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Client changes were saved."); }} />}
    </main>
  );
}
