"use client";

import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";
import {
  leadContactFieldDeletionPatch,
  stripLeadContactFields,
} from "../lib/leadContactFields";

const DAY_MS = 24 * 60 * 60 * 1000;
const FINAL_DAY_MS = 6 * DAY_MS;
const EXPIRES_MS = 7 * DAY_MS;

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
  const ClientNotes = firstValue(data.ClientNotes, data.clientNotes, data.Notes, data.notes, data.message, currentJob.notes);
  const BusinessNotes = firstValue(data.BusinessNotes, data.businessNotes);
  return {
    ...data,
    id,
    collectionKey,
    Name: firstValue(data.Name, data.name, data.fullName),
    Phone: firstValue(data.Phone, data.phone, data.phoneNumber, data.contact),
    Email: firstValue(data.Email, data.email),
    Address: firstValue(data.Address, data.address),
    Job: firstValue(data.Job, data.job, data.service, data.projectType, currentJob.type),
    ClientNotes,
    BusinessNotes,
    Notes: ClientNotes,
    EstimateDate: firstValue(data.EstimateDate, data.estimateDate, data.PreferredDate, data.preferredDate, data.PreferredDay, data.preferredDay, data.estimateDay, currentJob.estimateDate),
    EstimateTime: firstValue(data.EstimateTime, data.estimateTime, data.PreferredTime, data.preferredTime, currentJob.estimateTime),
  };
}

function rowTime(row) {
  return toMillis(row.createdAt || row.contactedAt || row.acceptedAt || row.movedAt || row.updatedAt);
}

function isEstimateRequestFinalDay(row) {
  if (row.collectionKey !== "contactedMe") return false;
  const createdAt = toMillis(row.createdAt || row.contactedAt || row.updatedAt);
  if (!createdAt) return false;
  const age = Date.now() - createdAt;
  return age >= FINAL_DAY_MS && age < EXPIRES_MS;
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

function safeFileName(value) {
  return String(value || "client").trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "client";
}

function downloadFile(fileName, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function calendarDate(row) {
  const rawDate = String(row.EstimateDate || "").trim();
  if (!rawDate) return null;
  let start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [year, month, day] = rawDate.split("-").map(Number);
    start = new Date(year, month - 1, day);
  } else {
    start = new Date(rawDate);
  }
  if (Number.isNaN(start.getTime())) return null;
  const normalizedTime = normalizeTimeForDate(row.EstimateTime) || "09:00";
  const [hour, minute] = normalizedTime.split(":").map(Number);
  start.setHours(hour, minute, 0, 0);
  return start;
}

function calendarDescription(row) {
  return [
    row.Job && `Job: ${row.Job}`,
    row.Phone && `Phone: ${row.Phone}`,
    row.Email && `Email: ${row.Email}`,
    row.ClientNotes && `Client notes: ${row.ClientNotes}`,
    row.BusinessNotes && `Business notes: ${row.BusinessNotes}`,
  ].filter(Boolean).join("\n");
}

function downloadCalendar(row, clientId, businessName, start) {
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const contents = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${escapeCalendar(businessName)}//ARK Client Center//EN`, "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${row.id}-${Date.now()}@${safeFileName(clientId)}-ocm`, `DTSTAMP:${calendarStamp(new Date())}`, `DTSTART:${calendarStamp(start)}`, `DTEND:${calendarStamp(end)}`,
    `SUMMARY:${escapeCalendar(`Estimate - ${row.Name || row.Address || "Client"}`)}`,
    `DESCRIPTION:${escapeCalendar(calendarDescription(row))}`,
    `LOCATION:${escapeCalendar(row.Address)}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  downloadFile(`${safeFileName(row.Name)}-estimate.ics`, contents, "text/calendar;charset=utf-8");
}

async function addCalendar(row, clientId, businessName) {
  const start = calendarDate(row);
  if (!start) return { ok: false, reason: "missing-date" };
  if (!Capacitor.isNativePlatform()) {
    downloadCalendar(row, clientId, businessName, start);
    return { ok: true, native: false };
  }
  try {
    const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
    const permission = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
    if (permission.result !== "granted") return { ok: false, reason: "calendar-permission" };
    await CapacitorCalendar.createEvent({
      title: `Estimate - ${row.Name || row.Address || "New client"}`,
      location: row.Address || "",
      startDate: start.getTime(),
      endDate: start.getTime() + 60 * 60 * 1000,
      description: calendarDescription(row),
    });
    return { ok: true, native: true };
  } catch (error) {
    console.error("Unable to add calendar event", error);
    return { ok: false, reason: "calendar-error" };
  }
}

function splitName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { given: parts[0] || "Client", family: "" };
  return { given: parts.shift(), family: parts.join(" ") };
}

function downloadContact(row, businessName) {
  if (!row.Name && !row.Phone && !row.Email) return false;
  const name = row.Name || row.Address || `${businessName} Client`;
  const contents = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${name}`,
    row.Phone ? `TEL;TYPE=CELL:${row.Phone}` : "",
    row.Email ? `EMAIL:${row.Email}` : "",
    row.Address ? `ADR;TYPE=WORK:;;${row.Address};;;;` : "",
    row.Job ? `NOTE:Requested service: ${row.Job}` : "",
    "END:VCARD",
  ].filter(Boolean).join("\r\n");
  downloadFile(`${safeFileName(name)}.vcf`, contents, "text/vcard;charset=utf-8");
  return true;
}

async function saveContact(row, businessName) {
  if (!row.Name && !row.Phone && !row.Email) return { ok: false, reason: "missing-contact" };
  if (!Capacitor.isNativePlatform()) return { ok: downloadContact(row, businessName), native: false };
  try {
    const { Contacts } = await import("@capacitor-community/contacts");
    let permission = await Contacts.checkPermissions();
    if (permission.contacts === "prompt" || permission.contacts === "prompt-with-rationale") permission = await Contacts.requestPermissions();
    if (permission.contacts !== "granted") return { ok: false, reason: "contacts-permission" };
    await Contacts.createContact({
      contact: {
        name: splitName(row.Name || row.Address || `${businessName} Client`),
        organization: { company: businessName, jobTitle: "Client" },
        note: [row.Job && `Requested service: ${row.Job}`, row.ClientNotes && `Client notes: ${row.ClientNotes}`, row.BusinessNotes && `Business notes: ${row.BusinessNotes}`].filter(Boolean).join("\n") || null,
        phones: row.Phone ? [{ type: "mobile", number: row.Phone, isPrimary: true }] : [],
        emails: row.Email ? [{ type: "work", address: row.Email, isPrimary: true }] : [],
        postalAddresses: row.Address ? [{ type: "work", street: row.Address, isPrimary: true }] : [],
      },
    });
    return { ok: true, native: true };
  } catch (error) {
    console.error("Unable to add contact", error);
    return { ok: false, reason: "contacts-error" };
  }
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
  const declining = row.collectionKey === "contactedMe";
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={declining ? "Confirm decline" : "Confirm deletion"}>
    <button type="button" className="fixed inset-0" onClick={onCancel} aria-label={declining ? "Cancel decline" : "Cancel deletion"} />
    <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      <div className="px-6 py-10 text-center">
        <h2 className="text-xl font-black text-slate-950">{declining ? "Decline" : "Delete"} {row.Name || "this record"}?</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">This cannot be undone.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? (declining ? "Declining…" : "Deleting…") : (declining ? "Decline" : "Delete")}</button>
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
    ClientNotes: row.ClientNotes || row.Notes || "",
    BusinessNotes: row.BusinessNotes || "",
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
          Notes: form.ClientNotes,
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
    <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-5 sm:p-7">{fields.map(([field, label, type]) => <label key={field} className={field === "Address" ? "col-span-2" : ""}><span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span><input type={type} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" /></label>)}<label className="col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Client Notes</span><textarea rows={4} value={form.ClientNotes} onChange={(event) => setForm((current) => ({ ...current, ClientNotes: event.target.value }))} className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" /></label><label className="col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Business Notes</span><textarea rows={4} value={form.BusinessNotes} onChange={(event) => setForm((current) => ({ ...current, BusinessNotes: event.target.value }))} placeholder="Add private notes for your business about this client or job." className="w-full rounded-xl border border-slate-300 bg-amber-50/40 p-3 text-sm outline-none focus:border-slate-950" /></label></div>
    <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-5 sm:grid-cols-4 sm:p-7">
      <button type="button" disabled={!messagesEnabled} onClick={onMessage} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:bg-slate-200 disabled:text-slate-500">Message</button>
      <button type="button" onClick={onAddContact} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Add Contact</button>
      <button type="button" onClick={() => onDate({ ...row, ...form })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Add to Calendar</button>
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
    const unsubContacted = onSnapshot(collection(db, "ocmClients", clientId, "contactedMe"), (snapshot) => setContacted(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "contactedMe")).sort((a, b) => rowTime(a) - rowTime(b))), () => setError("Something went wrong."));
    const unsubClients = onSnapshot(collection(db, "ocmClients", clientId, "clients"), (snapshot) => setClients(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "clients")).sort((a, b) => rowTime(a) - rowTime(b))), () => setError("Something went wrong."));
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
    if (!user || busy) return;
    setBusy(`accept:${row.id}`);
    setNotice("");
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/leads/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leadId: row.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not accept this estimate request.");
      if (result.noticeError) {
        setNotice(`${row.Name || "Lead"} was accepted, but the acceptance text could not be sent.`);
      } else {
        setNotice(`${row.Name || "Lead"} was accepted.`);
      }
    } catch (acceptError) {
      setError(acceptError.message || "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  async function remove(row) {
    if (!row || !user || busy) return;
    setBusy(`delete:${row.id}`);
    setNotice("");
    setError("");
    try {
      const token = await user.getIdToken(true);
      let declineResult = null;

      if (row.collectionKey === "contactedMe") {
        const declineResponse = await fetch("/api/business/leads/client-decline-notice", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ leadId: row.id, name: row.Name, phone: row.Phone }),
        });
        declineResult = await declineResponse.json().catch(() => ({}));
        if (!declineResponse.ok) throw new Error(declineResult.error || "Could not send the client decline notice.");
      }

      const deleteResponse = await fetch("/api/business/clients/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leadId: row.id, collectionKey: row.collectionKey }),
      });
      const deleteResult = await deleteResponse.json().catch(() => ({}));
      if (!deleteResponse.ok) throw new Error(deleteResult.error || "Could not delete this record.");

      if (row.collectionKey === "contactedMe" && declineResult?.sent === false && !declineResult?.skipped && !declineResult?.duplicate) {
        setNotice(`${row.Name || "Record"} was declined and removed, but the decline text could not be sent.`);
      } else if (row.collectionKey === "contactedMe") {
        setNotice(`${row.Name || "Record"} was declined and removed.`);
      } else {
        setNotice(`${row.Name || "Record"} was deleted.`);
      }
      if (viewing?.id === row.id) setViewing(null);
      setPendingDelete(null);
    } catch (removeError) {
      setError(removeError.message || "Something went wrong.");
    } finally {
      setBusy("");
    }
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
  async function addContact(row) {
    setError("");
    const result = await saveContact(row, businessName);
    if (!result.ok) {
      setError(result.reason === "contacts-permission" ? "Allow contact access to save this client." : "Add a name or phone number before saving a contact.");
      return;
    }
    setNotice(result.native ? "Contact added." : "Contact file downloaded. Open it to save the contact.");
  }
  async function confirmDate(row) {
    setError("");
    const result = await addCalendar(row, clientId, businessName);
    if (!result.ok) {
      setError(result.reason === "calendar-permission" ? "Allow calendar access to add this estimate." : "Add a valid estimate date before adding it to your calendar.");
      return;
    }
    setNotice(result.native ? "Estimate added to your calendar." : "Calendar file downloaded. Open it to add the estimate.");
  }
  function manageEmployee(row) { const key = `${row.collectionKey}:${row.id}`; setViewing(null); setOpenAssignment(key); }

  const inactiveCard = "min-h-36 rounded-3xl border border-slate-300 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]";
  const activeCard = "min-h-36 rounded-3xl border border-slate-900 bg-slate-900 p-5 text-left text-white shadow-sm transition active:scale-[0.99]";

  return <div className="px-3 pb-24 pt-4 sm:px-5 sm:pt-6 md:px-8"><div className="mx-auto max-w-6xl">{error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}{notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}<section className="rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5"><div className="grid grid-cols-2 gap-3 sm:gap-5"><button type="button" onClick={() => setActiveSection(activeSection === "contacted" ? null : "contacted")} className={activeSection === "contacted" ? activeCard : inactiveCard}><p className="text-4xl font-black">{contacted.length}</p><h2 className="mt-2 text-lg font-black">Contacted You</h2><p className="mt-1 text-xs font-semibold opacity-60">New receptionist leads</p></button><button type="button" onClick={() => setActiveSection(activeSection === "clients" ? null : "clients")} className={activeSection === "clients" ? activeCard : inactiveCard}><p className="text-4xl font-black">{clients.length}</p><h2 className="mt-2 text-lg font-black">Clients</h2><p className="mt-1 text-xs font-semibold opacity-60">Accepted people</p></button></div>{activeSection && <div className="mt-4 border-t border-slate-300 pt-4 sm:mt-5 sm:pt-5"><h2 className="text-2xl font-black">{activeSection === "contacted" ? "Contacted You" : "Clients"}</h2><div className="mt-4 space-y-3">{rows.map((row) => { const assignmentKey = `${row.collectionKey}:${row.id}`; const assignmentBusy = busy === `assign:${assignmentKey}`; const expiring = activeSection === "contacted" && isEstimateRequestFinalDay(row); return <article key={row.id} className={expiring ? "rounded-2xl border border-red-300 bg-red-50/70 p-4 shadow-sm" : "rounded-2xl border border-slate-300 bg-white p-4 shadow-sm"}><div className="flex items-start gap-3"><button type="button" onClick={() => activeSection === "clients" && setViewing(row)} className={activeSection === "clients" ? "min-w-0 flex-1 text-left" : "min-w-0 flex-1 cursor-default text-left"}><h3 className="truncate text-base font-black">{row.Name || "Unnamed person"}</h3><p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p></button>{activeSection === "clients" && <button type="button" aria-label="Delete client" title="Delete client" disabled={Boolean(busy)} onClick={() => setPendingDelete(row)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"><TrashIcon /></button>}</div>{activeSection === "contacted" && <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => accept(row)} className="rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Accept</button><button type="button" disabled={Boolean(busy)} onClick={() => setPendingDelete(row)} className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Decline</button></div>}{activeSection === "clients" && openAssignment === assignmentKey && <div className="mt-3 rounded-2xl border border-slate-300 bg-slate-100 p-3"><p className="text-xs font-black text-slate-700">Choose an employee</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{activeEmployees.map((employee) => <button key={employee.uid} type="button" disabled={Boolean(busy)} onClick={() => assignEmployee(row, employee.uid)} className={row.assignedEmployeeUid === employee.uid ? "rounded-xl bg-slate-950 px-3 py-3 text-left text-xs font-black text-white" : "rounded-xl border border-slate-300 bg-white px-3 py-3 text-left text-xs font-black text-slate-800"}>{assignmentBusy ? "Saving…" : employee.name}</button>)}{row.assignedEmployeeUid && <button type="button" disabled={Boolean(busy)} onClick={() => assignEmployee(row, "")} className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-left text-xs font-black text-red-700 sm:col-span-2">Remove Employee Assignment</button>}</div></div>}</article>; })}{rows.length === 0 && <p className="rounded-2xl border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-500">Nothing here yet.</p>}</div></div>}</section></div>{viewing && <ClientModal row={viewing} clientId={clientId} messagesEnabled={messagesEnabled} employeesEnabled={employeesEnabled} activeEmployees={activeEmployees} onClose={() => setViewing(null)} onMessage={() => openMessage(viewing)} onAddContact={() => addContact(viewing)} onDate={confirmDate} onManageEmployee={() => manageEmployee(viewing)} onSaved={() => setNotice("Client changes were saved.")} />}<ConfirmDialog row={pendingDelete} busy={Boolean(busy)} onCancel={() => !busy && setPendingDelete(null)} onConfirm={() => remove(pendingDelete)} /></div>;
}
