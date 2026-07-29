"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";
import {
  leadContactFieldDeletionPatch,
  stripLeadContactFields,
} from "../lib/leadContactFields";

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

function normalizeRow(id, source, collectionKey) {
  const data = stripLeadContactFields(source || {});
  const jobs = Array.isArray(data.Jobs) ? data.Jobs : [];
  const currentJob = jobs.at(-1) || {};
  return {
    ...data,
    id,
    collectionKey,
    Name: firstValue(data.Name, data.name, data.fullName),
    Phone: firstValue(data.Phone, data.phone, data.phoneNumber, data.contact),
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

function normalizeTimeForDate(value) {
  const text = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const meridiem = match[3].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}`;
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
  const start = new Date(`${row.EstimateDate}T${normalizeTimeForDate(row.EstimateTime) || "09:00"}:00`);
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

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>;
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const listener = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/60 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={title}><button type="button" className="fixed inset-0" onClick={onClose} aria-label="Close" /><div className="relative flex max-h-[96vh] min-h-[78vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">{children}</div></div>;
}

function ConfirmDialog({ row, busy, onCancel, onConfirm }) {
  if (!row) return null;
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirm deletion">
    <button type="button" className="fixed inset-0" onClick={onCancel} aria-label="Cancel deletion" />
    <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      <div className="px-6 py-10 text-center">
        <h2 className="text-xl font-black text-slate-950">Delete {row.Name || "this record"}?</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">This cannot be undone.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
      </div>
    </div>
  </div>;
}

function ClientModal({ row, clientId, messagesEnabled, employeesEnabled, activeEmployees, onClose, onMessage, onAddContact, onDate, onManageEmployee, onSaved }) {
  const canManageEmployees = employeesEnabled && activeEmployees.length > 0;
  const [form, setForm] = useState({
    Name: row.Name || "",
    Phone: row.Phone || "",
    Address: row.Address || "",
    Job: row.Job || "",
    EstimateDate: /^\d{4}-\d{2}-\d{2}$/.test(String(row.EstimateDate || "")) ? row.EstimateDate : "",
    EstimateTime: normalizeTimeForDate(row.EstimateTime),
    Notes: row.Notes || "",
  });
  const initialForm = useRef(JSON.stringify(form));
  const closing = useRef(false);

  async function closeWithAutosave() {
    if (closing.current) return;
    closing.current = true;
    try {
      if (JSON.stringify(form) !== initialForm.current) {
        await setDoc(doc(db, "ocmClients", clientId, row.collectionKey, row.id), {
          ...form,
          PreferredDate: form.EstimateDate,
          PreferredTime: form.EstimateTime,
          ...leadContactFieldDeletionPatch(deleteField()),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        onSaved();
      }
    } finally {
      onClose();
    }
  }

  const fields = [["Name", "Name", "text"], ["Phone", "Phone", "tel"], ["Address", "Address", "text"], ["Job", "Job type", "text"], ["EstimateDate", "Estimate date", "date"], ["EstimateTime", "Estimate time", "time"]];
  return <Modal title={form.Name || "Client"} onClose={closeWithAutosave}>
    <div className="flex items-center gap-3 border-b border-slate-200 p-4 sm:p-6">
      <button type="button" onClick={closeWithAutosave} aria-label="Back" title="Back" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white text-2xl font-black text-slate-900 shadow-sm">←</button>
      <h2 className="min-w-0 truncate text-2xl font-black sm:text-3xl">{form.Name || "Unnamed caller"}</h2>
    </div>
    <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-5 sm:p-7">{fields.map(([field, label, type]) => <label key={field} className={field === "Address" ? "col-span-2" : ""}><span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span><input type={type} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" /></label>)}<label className="col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Notes</span><textarea rows={5} value={form.Notes} onChange={(event) => setForm((current) => ({ ...current, Notes: event.target.value }))} className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" /></label></div>
    <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-5 sm:grid-cols-4 sm:p-7">
      <button type="button" disabled={!messagesEnabled} onClick={onMessage} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:bg-slate-200 disabled:text-slate-500">Message</button>
      <button type="button" onClick={onAddContact} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Add Contact</button>
      <button type="button" onClick={() => onDate({ ...row, ...form })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Confirm Date</button>
      <button type="button" disabled={!canManageEmployees} onClick={onManageEmployee} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black disabled:bg-slate-200 disabled:text-slate-400">Manage Employee</button>
    </div>
  </Modal>;
}

export default function ReviewClientsNative() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const clientId = profile?.clientId || "";
  const businessName = profile?.businessName || "Your Business";
  const messagesEnabled = profile?.messagesEnabled === true;
  const employeesEnabled = profile?.employeesEnabled === true;
  const [contacted, setContacted] = useState([]);
  const [clients, setClients] = useState([]);
  const [employeeWorkspace, setEmployeeWorkspace] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [openAssignment, setOpenAssignment] = useState("");
  const [viewing, setViewing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!clientId) return undefined;
    const unsubContacted = onSnapshot(collection(db, "ocmClients", clientId, "contactedMe"), (snapshot) => setContacted(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "contactedMe")).sort((a, b) => rowTime(b) - rowTime(a))), () => setError("Something went wrong."));
    const unsubClients = onSnapshot(collection(db, "ocmClients", clientId, "clients"), (snapshot) => setClients(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "clients")).sort((a, b) => rowTime(b) - rowTime(a))), () => setError("Something went wrong."));
    return () => { unsubContacted(); unsubClients(); };
  }, [clientId]);

  const loadEmployees = useCallback(async () => {
    if (!user || !employeesEnabled) { setEmployeeWorkspace(null); return; }
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/employees", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error();
      setEmployeeWorkspace(data);
    } catch {
      setEmployeeWorkspace(null);
    }
  }, [employeesEnabled, user]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { const section = searchParams.get("section"); if (section === "contacted" || section === "clients") setActiveSection(section); }, [searchParams]);

  const rows = activeSection === "contacted" ? contacted : activeSection === "clients" ? clients : [];
  const activeEmployees = (employeeWorkspace?.employees || []).filter((employee) => employee.status === "active");

  async function accept(row) {
    if (busy) return;
    setBusy(`accept:${row.id}`);
    try {
      const { id, collectionKey, ...data } = stripLeadContactFields(row);
      const batch = writeBatch(db);
      batch.set(doc(db, "ocmClients", clientId, "clients", row.id), { ...data, ...leadContactFieldDeletionPatch(deleteField()), currentStage: "clients", acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      batch.delete(doc(db, "ocmClients", clientId, "contactedMe", row.id));
      await batch.commit();
      setNotice(`${row.Name || "Lead"} was accepted.`);
    } catch { setError("Something went wrong."); } finally { setBusy(""); }
  }

  async function remove(row) {
    if (!row || busy) return;
    setBusy(`delete:${row.id}`);
    try {
      await deleteDoc(doc(db, "ocmClients", clientId, row.collectionKey, row.id));
      setNotice(`${row.Name || "Record"} was deleted.`);
      if (viewing?.id === row.id) setViewing(null);
      setPendingDelete(null);
    } catch { setError("Something went wrong."); } finally { setBusy(""); }
  }

  async function assignEmployee(row, employeeUid) {
    if (!user || busy || row.collectionKey !== "clients") return;
    setBusy(`assign:${row.collectionKey}:${row.id}`);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/employees", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "assign", collectionKey: row.collectionKey, recordId: row.id, employeeUid }) });
      if (!response.ok) throw new Error();
      const employee = activeEmployees.find((item) => item.uid === employeeUid);
      setNotice(employeeUid ? `${row.Name || "Client"} was assigned to ${employee?.name || "the employee"}.` : `${row.Name || "Client"} is now unassigned.`);
      setOpenAssignment("");
      await loadEmployees();
    } catch { setError("Something went wrong."); } finally { setBusy(""); }
  }

  function openMessage(row) { router.push(`/lead-messages?lead=${encodeURIComponent(row.id)}&collection=${row.collectionKey}`); }
  function addContact(row) { window.location.href = `tel:${String(row.Phone || "").replace(/[^+\d]/g, "")}`; }
  function confirmDate(row) {
    if (!downloadCalendar(row, businessName)) {
      setNotice("Add an estimate date before confirming it.");
      return;
    }
    setNotice("Calendar event created. Review it in your calendar app.");
  }
  function manageEmployee(row) { const key = `${row.collectionKey}:${row.id}`; setViewing(null); setOpenAssignment(key); }

  const inactiveCard = "min-h-36 rounded-3xl border border-slate-300 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]";
  const activeCard = "min-h-36 rounded-3xl border border-slate-900 bg-slate-900 p-5 text-left text-white shadow-sm transition active:scale-[0.99]";

  return <div className="px-3 pb-24 pt-4 sm:px-5 sm:pt-6 md:px-8"><div className="mx-auto max-w-6xl">{error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}{notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}<section className="rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5"><div className="grid grid-cols-2 gap-3 sm:gap-5"><button type="button" onClick={() => setActiveSection(activeSection === "contacted" ? null : "contacted")} className={activeSection === "contacted" ? activeCard : inactiveCard}><p className="text-4xl font-black">{contacted.length}</p><h2 className="mt-2 text-lg font-black">Contacted You</h2><p className="mt-1 text-xs font-semibold opacity-60">New receptionist leads</p></button><button type="button" onClick={() => setActiveSection(activeSection === "clients" ? null : "clients")} className={activeSection === "clients" ? activeCard : inactiveCard}><p className="text-4xl font-black">{clients.length}</p><h2 className="mt-2 text-lg font-black">Clients</h2><p className="mt-1 text-xs font-semibold opacity-60">Accepted people</p></button></div>{activeSection && <div className="mt-4 border-t border-slate-300 pt-4 sm:mt-5 sm:pt-5"><h2 className="text-2xl font-black">{activeSection === "contacted" ? "Contacted You" : "Clients"}</h2><div className="mt-4 space-y-3">{rows.map((row) => { const assignmentKey = `${row.collectionKey}:${row.id}`; const assignmentBusy = busy === `assign:${assignmentKey}`; return <article key={row.id} className="rounded-2xl border border-slate-300 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><button type="button" onClick={() => activeSection === "clients" && setViewing(row)} className={activeSection === "clients" ? "min-w-0 flex-1 text-left" : "min-w-0 flex-1 cursor-default text-left"}><h3 className="truncate text-base font-black">{row.Name || "Unnamed person"}</h3><p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p></button>{activeSection === "clients" && <button type="button" aria-label="Delete client" title="Delete client" disabled={Boolean(busy)} onClick={() => setPendingDelete(row)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"><TrashIcon /></button>}</div>{activeSection === "contacted" && <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => accept(row)} className="rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Accept</button><button type="button" disabled={Boolean(busy)} onClick={() => setPendingDelete(row)} className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div>}{activeSection === "clients" && openAssignment === assignmentKey && <div className="mt-3 rounded-2xl border border-slate-300 bg-slate-100 p-3"><p className="text-xs font-black text-slate-700">Choose an employee</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{activeEmployees.map((employee) => <button key={employee.uid} type="button" disabled={Boolean(busy)} onClick={() => assignEmployee(row, employee.uid)} className={row.assignedEmployeeUid === employee.uid ? "rounded-xl bg-slate-950 px-3 py-3 text-left text-xs font-black text-white" : "rounded-xl border border-slate-300 bg-white px-3 py-3 text-left text-xs font-black text-slate-800"}>{assignmentBusy ? "Saving…" : employee.name}</button>)}{row.assignedEmployeeUid && <button type="button" disabled={Boolean(busy)} onClick={() => assignEmployee(row, "")} className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-left text-xs font-black text-red-700 sm:col-span-2">Remove Employee Assignment</button>}</div></div>}</article>; })}{rows.length === 0 && <p className="rounded-2xl border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-500">Nothing here yet.</p>}</div></div>}</section></div>{viewing && <ClientModal row={viewing} clientId={clientId} messagesEnabled={messagesEnabled} employeesEnabled={employeesEnabled} activeEmployees={activeEmployees} onClose={() => setViewing(null)} onMessage={() => openMessage(viewing)} onAddContact={() => addContact(viewing)} onDate={confirmDate} onManageEmployee={() => manageEmployee(viewing)} onSaved={() => setNotice("Client changes were saved.")} />}<ConfirmDialog row={pendingDelete} busy={Boolean(busy)} onCancel={() => !busy && setPendingDelete(null)} onConfirm={() => remove(pendingDelete)} /></div>;
}
