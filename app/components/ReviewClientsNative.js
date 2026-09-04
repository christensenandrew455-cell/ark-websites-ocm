"use client";

import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { isEmergencyRequest, normalizeRequestUrgency } from "../lib/emergencyService";
import { MESSAGES_AVAILABLE } from "../lib/launchFeatures";
import { ownerFacingError } from "../lib/userFacingError";
import { stripLeadContactFields } from "../lib/leadContactFields";
import { leadRiskLabel, leadRiskLevel } from "../lib/leadRiskAssessment";
import InfoTip from "./InfoTip";
import {
  compareOldestLead,
  formatLeadReceivedAt,
  leadCreatedAt,
  regularLeadAgeBand,
} from "../lib/leadQueuePresentation";

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function serviceRequestSummaryItems(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter((line) => /^(?:Service|Preferred (?:time|window)|Address|Notes):\s*\S/i.test(line))
    .slice(0, 4);
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
    RequestSummary: firstValue(data.RequestSummary, data.requestSummary, data.serviceRequestSummary),
    riskAssessed: data.riskAssessed === true,
    riskScore: Math.max(0, Math.floor(Number(data.riskScore) || 0)),
    riskLevel: leadRiskLevel(data.riskScore),
    ClientNotes,
    BusinessNotes,
    Notes: ClientNotes,
    PreferredDay: firstValue(data.PreferredDay, data.preferredDay, data.PreferredDate, data.preferredDate, data.requestedDate, data.estimateDay),
    PreferredTimeWindow: firstValue(data.PreferredTimeWindow, data.preferredTimeWindow, data.requestedTimeWindow, data.PreferredTime, data.preferredTime, data.requestedTime),
    RequestUrgency: normalizeRequestUrgency(data),
    EstimateDate: firstValue(data.EstimateDate, data.estimateDate, currentJob.estimateDate),
    EstimateTime: firstValue(data.EstimateTime, data.estimateTime, currentJob.estimateTime),
  };
}

async function leadsApi(user, options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch("/api/business/leads", {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not load leads.");
  return data;
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

function displayRequestedDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [year, month, day] = raw.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function displayRequestedTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return raw;
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function requestedSchedule(row) {
  const day = displayRequestedDate(row.PreferredDay);
  const window = displayRequestedTime(row.PreferredTimeWindow);
  if (day && window) return `${day} · ${window}`;
  return day || window;
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
  const normalizedTime = normalizeTimeForDate(row.EstimateTime);
  if (!normalizedTime) return null;
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

const riskBadgeClasses = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  moderate: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-orange-200 bg-orange-50 text-orange-800",
  "very-high": "border-red-200 bg-red-50 text-red-800",
};

const riskIcons = { low: "🟢", moderate: "🟡", high: "🟠", "very-high": "🔴" };

function RiskBadge({ row }) {
  if (row.riskAssessed !== true) {
    return <span className="mt-3 inline-flex items-center gap-2"><span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">Risk check unavailable</span><InfoTip label="About risk checks">ARK looks for warning signs in the request. Use this as one signal, not a final decision.</InfoTip></span>;
  }
  const level = leadRiskLevel(row.riskScore);
  const points = Math.max(0, Math.floor(Number(row.riskScore) || 0));
  return <span className="mt-3 inline-flex items-center gap-2"><span aria-label={`${leadRiskLabel(level)}, ${points} points`} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black ${riskBadgeClasses[level]}`}><span aria-hidden="true">{riskIcons[level]}</span>{leadRiskLabel(level)} · {points} {points === 1 ? "point" : "points"}</span><InfoTip label="About lead risk">Low is 0–2 points, Moderate 3–5, High 6–8, and Very high 9 or more. Review the request before deciding.</InfoTip></span>;
}

function EmergencyBadge({ row }) {
  if (!isEmergencyRequest(row)) return null;
  return <span className="mb-2 inline-flex rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-black uppercase tracking-[0.08em] text-red-800">Emergency · ASAP</span>;
}

const regularLeadCardClasses = {
  new: "border-blue-400 bg-white",
  waiting: "border-amber-400 bg-amber-50/40",
  overdue: "border-red-500 bg-red-50/60",
};

function LeadReceivedTime({ row, now }) {
  const receivedAt = leadCreatedAt(row);
  const label = formatLeadReceivedAt(receivedAt, now);
  if (!label || receivedAt === null) return null;
  const receivedDate = new Date(receivedAt);
  return <time dateTime={receivedDate.toISOString()} title={receivedDate.toLocaleString()} className="shrink-0 rounded-lg bg-slate-950/5 px-2 py-1 text-xs font-black text-slate-600">{label}</time>;
}

function PendingLeadCard({ row, now, busy, onAccept, onDecline }) {
  const emergency = isEmergencyRequest(row);
  const ageBand = regularLeadAgeBand(leadCreatedAt(row), now);
  const cardClasses = emergency
    ? "border-red-500 bg-red-50"
    : regularLeadCardClasses[ageBand];
  const requestedDay = displayRequestedDate(row.PreferredDay);
  const requestedWindow = displayRequestedTime(row.PreferredTimeWindow);
  const notes = row.ClientNotes || row.Notes;

  return <article className={`rounded-2xl border-2 p-4 shadow-sm ${cardClasses}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <EmergencyBadge row={row} />
        <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Job type</span>
        <h4 className="mt-1 break-words text-base font-black text-slate-950">{row.Job || "Service not entered"}</h4>
      </div>
      <LeadReceivedTime row={row} now={now} />
    </div>
    {!emergency && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3">
        <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Requested day</span>
        <p className="mt-1 text-sm font-black text-slate-900">{requestedDay || "Not provided"}</p>
      </div>
      <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3">
        <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Time window</span>
        <p className="mt-1 text-sm font-black text-slate-900">{requestedWindow || "Not provided"}</p>
      </div>
    </div>}
    <div className="mt-3 rounded-xl border border-slate-200/90 bg-white/80 p-3">
      <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Notes</span>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-5 text-slate-700">{notes || "No notes provided."}</p>
    </div>
    <RiskBadge row={row} />
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button type="button" disabled={Boolean(busy)} onClick={() => onAccept(row)} className="rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">{busy === `accept:${row.id}` ? "Accepting…" : "Accept"}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => onDecline(row)} className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Decline</button>
    </div>
  </article>;
}

function PendingLeadSection({ title, rows, now, busy, onAccept, onDecline, emptyMessage }) {
  return <section aria-label={`${title} service requests`}>
    <div className="mb-3 flex items-center gap-2">
      <h3 className="text-lg font-black text-slate-950">{title}</h3>
      <span className="rounded-full bg-slate-950 px-2 py-0.5 text-xs font-black text-white">{rows.length}</span>
    </div>
    <div className="space-y-3">
      {rows.map((row) => <PendingLeadCard key={row.id} row={row} now={now} busy={busy} onAccept={onAccept} onDecline={onDecline} />)}
      {rows.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">{emptyMessage}</p>}
    </div>
  </section>;
}

function AcceptedLeadCard({ row, busy, onView, onDelete }) {
  const emergency = isEmergencyRequest(row);
  const schedule = requestedSchedule(row);
  return <article className={emergency ? "rounded-2xl border-2 border-red-400 bg-red-50 p-4 shadow-sm" : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"}>
    <div className="flex items-start gap-3">
      <button type="button" onClick={() => onView(row)} className="min-w-0 flex-1 text-left">
        <EmergencyBadge row={row} />
        <h3 className="truncate text-base font-black">{row.Name || "Unnamed person"}</h3>
        <p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
        {schedule && <p className="mt-2 text-sm font-black text-blue-800">Requested: {schedule}</p>}
      </button>
      <button type="button" aria-label="Delete client" title="Delete client" disabled={Boolean(busy)} onClick={() => onDelete(row)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-300 bg-red-50 text-red-700 disabled:opacity-50"><TrashIcon /></button>
    </div>
  </article>;
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const listener = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onClose]);
  return <div className="ark-modal-overlay" role="dialog" aria-modal="true" aria-label={title}><button type="button" onClick={onClose} aria-label="Close" /><div className="ark-modal-surface flex min-h-[78vh] max-w-5xl flex-col">{children}</div></div>;
}

function ConfirmDialog({ row, busy, onCancel, onConfirm }) {
  if (!row) return null;
  const declining = row.collectionKey === "contactedMe";
  return <div className="ark-modal-overlay" role="dialog" aria-modal="true" aria-label={declining ? "Confirm decline" : "Confirm deletion"}>
    <button type="button" onClick={onCancel} aria-label={declining ? "Cancel decline" : "Cancel deletion"} />
    <div className="ark-modal-surface max-w-sm">
      <div className="px-6 py-10 text-center">
        <h2 className="text-xl font-black text-slate-950">{declining ? "Decline" : "Delete"} {row.Name || "this record"}?</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">{declining ? "This lead will be permanently removed." : "This cannot be undone."}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? (declining ? "Declining…" : "Deleting…") : (declining ? "Decline" : "Delete")}</button>
      </div>
    </div>
  </div>;
}

function LeadLimitDialog({ plan, onClose, onManage }) {
  if (!plan) return null;
  return <div className="ark-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="accepted-lead-limit-title">
    <button type="button" onClick={onClose} aria-label="Close accepted lead limit" />
    <section className="ark-modal-surface max-w-md p-6 text-slate-950 sm:p-8">
      <h2 id="accepted-lead-limit-title" className="text-2xl font-black">No accepted leads left.</h2>
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Your limit resets to {plan.monthlyAcceptedLeadLimit || 25} at your next billing renewal.</p>
      <div className="mt-6 space-y-3">
        <button type="button" onClick={() => onManage("plan")} className="w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-black text-white">Change plan</button>
        <button type="button" onClick={() => onManage("topup")} className="w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Buy extra leads</button>
        <button type="button" onClick={onClose} className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800">Wait until renewal</button>
      </div>
    </section>
  </div>;
}

function ClientModal({ row, messagesEnabled, onClose, onMessage, onAddContact, onDate, onSave, onSaved }) {
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function closeWithAutosave() {
    if (closing.current) return;
    closing.current = true;
    try {
      if (JSON.stringify(form) !== initialForm.current) {
        setSaving(true);
        setSaveError("");
        await onSave(row, form);
        onSaved();
      }
      onClose();
    } catch (error) {
      setSaveError(ownerFacingError(error));
      setSaving(false);
      closing.current = false;
    }
  }

  const fields = [["Name", "Name", "text"], ["Phone", "Phone", "tel"], ["Address", "Address", "text"], ["Job", "Job type", "text"], ["EstimateDate", "Estimate date", "date"], ["EstimateTime", "Estimate time", "time"]];
  const requested = requestedSchedule(row);
  const requestSummary = serviceRequestSummaryItems(row.RequestSummary);
  return <Modal title={form.Name || "Client"} onClose={closeWithAutosave}>
    <div className="flex items-center gap-3 border-b border-slate-200 p-4 sm:p-6">
      <button type="button" disabled={saving} onClick={closeWithAutosave} aria-label="Back" title="Back" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white text-2xl font-black text-slate-900 shadow-sm disabled:opacity-50">←</button>
      <div className="min-w-0"><EmergencyBadge row={row} /><h2 className="truncate text-2xl font-black sm:text-3xl">{form.Name || "Unnamed caller"}</h2></div>
    </div>
    <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-5 sm:p-7">
      {saveError && <div className="col-span-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{saveError}</div>}
      <div className="col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Requested service window</span>
        <p className="mt-1 text-base font-black text-blue-950">{requested || "No requested window was provided."}</p>
      </div>
      {requestSummary.length > 0 && <section className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Service request summary">
        <h3 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">Service request summary</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold leading-6 text-slate-800">
          {requestSummary.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>}
      {fields.map(([field, label, type]) => <label key={field} className={field === "Address" ? "col-span-2" : ""}>
        <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <input type={type} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} className="h-12 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
      </label>)}
      <label className="col-span-2">
        <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Client notes</span>
        <textarea rows={4} value={form.ClientNotes} onChange={(event) => setForm((current) => ({ ...current, ClientNotes: event.target.value }))} className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" />
      </label>
      <div className="col-span-2">
        <div className="mb-1 flex items-center gap-2"><label htmlFor="business-notes" className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Business notes</label><InfoTip label="About business notes">These notes stay private to your business.</InfoTip></div>
        <textarea id="business-notes" rows={4} value={form.BusinessNotes} onChange={(event) => setForm((current) => ({ ...current, BusinessNotes: event.target.value }))} placeholder="Private note" className="w-full rounded-xl border border-slate-300 bg-amber-50/40 p-3 text-sm outline-none focus:border-slate-950" />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-5 sm:grid-cols-4 sm:p-7">
      {MESSAGES_AVAILABLE && <button type="button" disabled={!messagesEnabled} onClick={onMessage} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:bg-slate-200 disabled:text-slate-500">Message</button>}
      <button type="button" onClick={onAddContact} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Add Contact</button>
      <button type="button" onClick={() => onDate({ ...row, ...form })} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Add to Calendar</button>
    </div>
  </Modal>;
}

export default function ReviewClientsNative() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const clientId = profile?.clientId || "";
  const businessName = profile?.businessName || "Your Business";
  const messagesEnabled = MESSAGES_AVAILABLE && profile?.messagesEnabled === true;
  const [contacted, setContacted] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [leadLimit, setLeadLimit] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [clockNow, setClockNow] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const data = await leadsApi(user);
      setContacted((data.contacted || []).map((item) => normalizeRow(item.id, item, "contactedMe")).sort(compareOldestLead));
      setClients((data.clients || []).map((item) => normalizeRow(item.id, item, "clients")).sort(compareOldestLead));
      setError("");
    } catch (loadError) {
      setError(ownerFacingError(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 30_000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    const refreshClock = () => setClockNow(Date.now());
    refreshClock();
    const timer = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { const section = searchParams.get("section"); if (section === "contacted" || section === "clients") setActiveSection(section); }, [searchParams]);

  const emergencyLeads = contacted.filter((row) => isEmergencyRequest(row)).sort(compareOldestLead);
  const regularLeads = contacted.filter((row) => !isEmergencyRequest(row)).sort(compareOldestLead);

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
      if (!response.ok) {
        if (result.code === "MONTHLY_ACCEPTED_LEAD_LIMIT_REACHED") {
          setLeadLimit(result.plan || {});
          return;
        }
        throw new Error(result.error || "Could not accept this service request.");
      }
      if (result.duplicate) {
        setNotice(`${row.Name || "Lead"} was already accepted.`);
      } else if (result.noticeError) {
        setNotice(`${row.Name || "Lead"} was accepted, but the acceptance text could not be sent.`);
      } else {
        setNotice(`${row.Name || "Lead"} was accepted.`);
      }
      if (result.record) {
        const acceptedRow = normalizeRow(result.record.id, result.record, "clients");
        setContacted((current) => current.filter((item) => item.id !== row.id));
        setClients((current) => [...current.filter((item) => item.id !== acceptedRow.id), acceptedRow].sort(compareOldestLead));
      }
      await load(true);
    } catch (acceptError) {
      setError(ownerFacingError(acceptError));
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
          body: JSON.stringify({ leadId: row.id }),
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
      await load(true);
    } catch (removeError) {
      setError(ownerFacingError(removeError));
    } finally {
      setBusy("");
    }
  }

  async function saveClient(row, fields) {
    if (!user) throw new Error("Sign in to save this client.");
    const data = await leadsApi(user, {
      method: "PATCH",
      body: JSON.stringify({ leadId: row.id, collectionKey: row.collectionKey, fields }),
    });
    const updated = normalizeRow(data.record.id, data.record, row.collectionKey);
    setClients((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
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
      setError(result.reason === "calendar-permission" ? "Allow calendar access to add this estimate." : "Add a valid confirmed estimate date and time before adding it to your calendar.");
      return;
    }
    setNotice(result.native ? "Estimate added to your calendar." : "Calendar file downloaded. Open it to add the estimate.");
  }

  const inactiveCard = "min-h-36 rounded-3xl border border-slate-200 bg-white p-5 text-left text-slate-950 shadow-sm transition active:scale-[0.99]";
  const activeCard = "min-h-36 rounded-3xl border border-blue-800 bg-blue-800 p-5 text-left text-white shadow-sm transition active:scale-[0.99]";

  return <div className="px-3 pb-24 pt-4 sm:px-5 sm:pt-6 md:px-8">
    <div className="mx-auto max-w-6xl">
      {error && <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
        <span>{error}</span>
        <button type="button" disabled={loading} onClick={() => load()} className="shrink-0 rounded-lg bg-red-700 px-3 py-2 text-xs text-white disabled:opacity-50">Try again</button>
      </div>}
      {notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
      <section className="rounded-3xl border border-slate-200 bg-slate-200/60 p-3 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          <button type="button" onClick={() => setActiveSection(activeSection === "contacted" ? null : "contacted")} className={activeSection === "contacted" ? activeCard : inactiveCard}>
            <p className="text-4xl font-black">{contacted.length}</p>
            <h2 className="mt-2 text-lg font-black">Contacted You</h2>
            <p className="mt-1 text-xs font-semibold opacity-70">New leads</p>
          </button>
          <button type="button" onClick={() => setActiveSection(activeSection === "clients" ? null : "clients")} className={activeSection === "clients" ? activeCard : inactiveCard}>
            <p className="text-4xl font-black">{clients.length}</p>
            <h2 className="mt-2 text-lg font-black">Clients</h2>
            <p className="mt-1 text-xs font-semibold opacity-70">Accepted</p>
          </button>
        </div>
        {activeSection === "contacted" && <div className="mt-4 border-t border-slate-300 pt-4 text-slate-950 sm:mt-5 sm:pt-5">
          <div className="flex items-center gap-2"><h2 className="text-2xl font-black">Contacted You</h2><InfoTip label="About Contacted You">New requests appear here. Accepting one reveals the customer and counts once toward your monthly plan. Card colors show age; red Emergency cards are urgent requests.</InfoTip></div>
          <div className="mt-4 space-y-7">
            {emergencyLeads.length > 0 && <PendingLeadSection title="Emergencies" rows={emergencyLeads} now={clockNow} busy={busy} onAccept={accept} onDecline={setPendingDelete} emptyMessage="No emergency requests." />}
            <PendingLeadSection title="Regular" rows={regularLeads} now={clockNow} busy={busy} onAccept={accept} onDecline={setPendingDelete} emptyMessage={loading ? "Loading leads…" : "No regular requests."} />
          </div>
        </div>}
        {activeSection === "clients" && <div className="mt-4 border-t border-slate-300 pt-4 text-slate-950 sm:mt-5 sm:pt-5">
          <h2 className="text-2xl font-black">Clients</h2>
          <div className="mt-4 space-y-3 text-slate-950">
            {clients.map((row) => <AcceptedLeadCard key={row.id} row={row} busy={busy} onView={setViewing} onDelete={setPendingDelete} />)}
            {clients.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">{loading ? "Loading leads…" : "Nothing here yet."}</p>}
          </div>
        </div>}
      </section>
    </div>
    {viewing && <ClientModal row={viewing} messagesEnabled={messagesEnabled} onClose={() => setViewing(null)} onMessage={() => openMessage(viewing)} onAddContact={() => addContact(viewing)} onDate={confirmDate} onSave={saveClient} onSaved={() => setNotice("Client changes were saved.")} />}
    <ConfirmDialog row={pendingDelete} busy={Boolean(busy)} onCancel={() => !busy && setPendingDelete(null)} onConfirm={() => remove(pendingDelete)} />
    <LeadLimitDialog plan={leadLimit} onClose={() => setLeadLimit(null)} onManage={(panel) => router.push(`/settings?section=payment&manage=${panel}`)} />
  </div>;
}
