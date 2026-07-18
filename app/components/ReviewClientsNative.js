"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
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
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

const ACCEPTED_COLLECTIONS = ["preClients", "clients", "postClients"];
const TIME_RANGES = [
  { key: "today", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ContactEditor = registerPlugin("ContactEditor");

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
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
    EstimateDate: firstValue(
      data.EstimateDate,
      data.estimateDate,
      data.PreferredDate,
      data.preferredDate,
      data.PreferredDay,
      data.preferredDay,
      data.estimateDay,
      currentJob.estimateDate
    ),
    RequestedWeekday: firstValue(data.RequestedWeekday, data.requestedWeekday),
    EstimateTime: firstValue(
      data.EstimateTime,
      data.estimateTime,
      data.PreferredTime,
      data.preferredTime,
      currentJob.estimateTime
    ),
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function rowTime(row) {
  return toMillis(row.createdAt || row.acceptedAt || row.movedAt || row.updatedAt);
}

function rangeTime(row, section) {
  if (section === "clients") {
    return toMillis(row.acceptedAt || row.movedAt || row.updatedAt || row.createdAt);
  }
  return toMillis(row.createdAt || row.updatedAt || row.acceptedAt);
}

function insideRange(row, range, section) {
  if (range === "all") return true;
  const value = rangeTime(row, section);
  if (!value) return false;
  const now = new Date();
  const start = range === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return value >= start;
}

function safeFileName(value) {
  return String(value || "client")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "client";
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

function escapeCalendarText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function calendarStamp(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function parseClock(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\./g, "");
  const match = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || "";

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute, total: hour * 60 + minute };
}

function nextRequestedWeekday(rawDay, rawTime = "") {
  const key = String(rawDay || "").trim().toLowerCase();
  const target = WEEKDAYS.findIndex((day) => day === key || day.startsWith(key.slice(0, 3)));
  if (target < 0) return null;

  const now = new Date();
  let daysAhead = (target - now.getDay() + 7) % 7;
  const requestedClock = parseClock(rawTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (daysAhead === 0 && requestedClock && requestedClock.total <= nowMinutes) daysAhead = 7;

  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead);
}

function calendarDate(row) {
  const rawDate = String(row.EstimateDate || row.RequestedWeekday || "").trim();
  if (!rawDate) return null;

  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [year, month, day] = rawDate.split("-").map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = nextRequestedWeekday(rawDate, row.EstimateTime);
    if (!date) {
      const parsed = new Date(rawDate);
      date = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) return null;

  const clock = parseClock(row.EstimateTime);
  if (clock) date.setHours(clock.hour, clock.minute, 0, 0);
  else date.setHours(9, 0, 0, 0);
  return date;
}

function displayRequestedDate(row) {
  const date = calendarDate(row);
  if (!date) return firstValue(row.EstimateDate, row.RequestedWeekday, "Not selected");
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function calendarDescription(row) {
  return [
    row.Job && `Job: ${row.Job}`,
    row.Phone && `Phone: ${row.Phone}`,
    row.Email && `Email: ${row.Email}`,
    row.Notes && `Notes: ${row.Notes}`,
  ].filter(Boolean).join("\n");
}

function addCalendarFile(row, clientId, businessName, start) {
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const title = `Estimate - ${row.Name || row.Address || "New client"}`;
  const uid = `${row.id}-${Date.now()}@${safeFileName(clientId)}-ocm`;
  const now = new Date();
  const contents = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${escapeCalendarText(businessName)}//ARK Client Center//EN`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${calendarStamp(now)}`,
    `DTSTART:${calendarStamp(start)}`,
    `DTEND:${calendarStamp(end)}`,
    `SUMMARY:${escapeCalendarText(title)}`,
    `DESCRIPTION:${escapeCalendarText(calendarDescription(row))}`,
    `LOCATION:${escapeCalendarText(row.Address)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  downloadFile(`${safeFileName(row.Name || row.Address)}-estimate.ics`, contents, "text/calendar;charset=utf-8");
}

function addContactFile(row, businessName) {
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

async function openCalendarEditor(row, clientId, businessName) {
  const start = calendarDate(row);
  if (!start) return { ok: false, reason: "missing-date" };

  if (!Capacitor.isNativePlatform()) {
    addCalendarFile(row, clientId, businessName, start);
    return { ok: true, native: false };
  }

  try {
    const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
    const permission = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
    if (permission.result !== "granted") return { ok: false, reason: "calendar-permission" };

    await CapacitorCalendar.createEventWithPrompt({
      title: `Estimate - ${row.Name || row.Address || "New client"}`,
      location: row.Address || "",
      startDate: start.getTime(),
      endDate: start.getTime() + 60 * 60 * 1000,
      description: calendarDescription(row),
    });
    return { ok: true, native: true };
  } catch (error) {
    console.error("Unable to open native calendar editor", error);
    return { ok: false, reason: "calendar-error" };
  }
}

function splitName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { given: parts[0] || "Client", family: "" };
  return { given: parts.shift(), family: parts.join(" ") };
}

async function openContactEditor(row, businessName) {
  if (!row.Name && !row.Phone && !row.Email) return { ok: false, reason: "missing-contact" };

  if (!Capacitor.isNativePlatform()) {
    return { ok: addContactFile(row, businessName), native: false };
  }

  if (Capacitor.getPlatform() === "android") {
    try {
      await ContactEditor.open({
        name: row.Name || row.Address || `${businessName} Client`,
        phone: row.Phone || "",
        email: row.Email || "",
        address: row.Address || "",
        note: [row.Job && `Requested service: ${row.Job}`, row.Notes].filter(Boolean).join("\n"),
      });
      return { ok: true, native: true, editor: true };
    } catch (error) {
      console.error("Unable to open Android contact editor", error);
      return { ok: false, reason: "contacts-error" };
    }
  }

  try {
    const { Contacts } = await import("@capacitor-community/contacts");
    let permission = await Contacts.checkPermissions();
    if (permission.contacts === "prompt" || permission.contacts === "prompt-with-rationale") {
      permission = await Contacts.requestPermissions();
    }
    if (permission.contacts !== "granted" && permission.contacts !== "limited") {
      return { ok: false, reason: "contacts-permission" };
    }

    const name = splitName(row.Name || row.Address || `${businessName} Client`);
    await Contacts.createContact({
      contact: {
        name,
        organization: { company: businessName, jobTitle: "Client" },
        note: [row.Job && `Requested service: ${row.Job}`, row.Notes].filter(Boolean).join("\n") || null,
        phones: row.Phone ? [{ type: "mobile", number: row.Phone, isPrimary: true }] : [],
        emails: row.Email ? [{ type: "work", address: row.Email, isPrimary: true }] : [],
        postalAddresses: row.Address ? [{ type: "work", street: row.Address, isPrimary: true }] : [],
      },
    });
    return { ok: true, native: true, editor: false };
  } catch (error) {
    console.error("Unable to add native contact", error);
    return { ok: false, reason: "contacts-error" };
  }
}

async function markLeadsViewed(user) {
  if (!user) return;
  try {
    const token = await user.getIdToken(true);
    await fetch("/api/notifications/device", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "mark-viewed" }),
    });
    if (Capacitor.isNativePlatform()) {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await PushNotifications.removeAllDeliveredNotifications();
    }
  } catch (error) {
    console.warn("Unable to mark lead notifications viewed", error);
  }
}

function Detail({ label, value, wide = false }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 sm:text-xs">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-900">{value || "—"}</p>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="fixed inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div className="relative mx-auto my-3 max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl sm:my-8">{children}</div>
    </div>
  );
}

function ViewModal({ row, onClose, onContact, onDate }) {
  return (
    <Modal title="Client details" onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-6">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">Client details</p>
          <h2 className="mt-1 truncate text-xl font-black sm:mt-2 sm:text-2xl">{row.Name || "Unnamed caller"}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold sm:text-sm">Close</button>
      </div>
      <div className="grid grid-cols-2 gap-4 p-4 sm:gap-5 sm:p-6">
        <Detail label="Phone" value={row.Phone} />
        <Detail label="Email" value={row.Email} />
        <Detail label="Address" value={row.Address} wide />
        <Detail label="Job type" value={row.Job} />
        <Detail label="Requested date" value={displayRequestedDate(row)} />
        <Detail label="Requested time" value={row.EstimateTime} />
        <Detail label="Notes" value={row.Notes} wide />
      </div>
      {row.collectionKey !== "contactedMe" && (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-4 sm:p-6">
          <button type="button" onClick={onContact} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black">Add Contact</button>
          <button type="button" onClick={onDate} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Confirm Date</button>
        </div>
      )}
    </Modal>
  );
}

function EditModal({ row, clientId, onClose, onSaved }) {
  const [form, setForm] = useState({
    Name: row.Name || "",
    Phone: row.Phone || "",
    Email: row.Email || "",
    Address: row.Address || "",
    Job: row.Job || "",
    EstimateDate: /^\d{4}-\d{2}-\d{2}$/.test(String(row.EstimateDate || "")) ? row.EstimateDate : "",
    EstimateTime: row.EstimateTime || "",
    Notes: row.Notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await setDoc(doc(db, "ocmClients", clientId, row.collectionKey || "clients", row.id), {
        ...form,
        PreferredDate: form.EstimateDate,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onSaved();
    } catch (saveError) {
      console.error(saveError);
      setError("Could not save this client.");
    } finally {
      setSaving(false);
    }
  }

  const fields = [
    ["Name", "Name", "text"],
    ["Phone", "Phone", "tel"],
    ["Email", "Email", "email"],
    ["Address", "Address", "text"],
    ["Job", "Job type", "text"],
    ["EstimateDate", "Estimate date", "date"],
    ["EstimateTime", "Estimate time", "time"],
  ];

  return (
    <Modal title="Edit client" onClose={onClose}>
      <form onSubmit={save}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-6">
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">Client record</p><h2 className="mt-1 text-xl font-black sm:mt-2 sm:text-2xl">Edit client</h2></div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold sm:text-sm">Close</button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 sm:p-6">
          {fields.map(([field, label, type]) => (
            <label key={field} className={field === "Address" ? "col-span-2" : ""}>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{label}</span>
              <input type={type} value={form[field]} onChange={(event) => update(field, event.target.value)} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 sm:h-11" />
            </label>
          ))}
          <label className="col-span-2">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">Notes</span>
            <textarea rows={3} value={form.Notes} onChange={(event) => update("Notes", event.target.value)} className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-950" />
          </label>
          {error && <div className="col-span-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 sm:p-6">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button>
          <button disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">{children}</div>;
}

function SummaryCard({ title, subtitle, count, active, loading, onClick }) {
  return (
    <button type="button" onClick={onClick} className={active
      ? "min-h-40 rounded-3xl border border-slate-950 bg-slate-950 p-5 text-left text-white shadow-sm sm:min-h-52 sm:p-7"
      : "min-h-40 rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition active:scale-[0.98] sm:min-h-52 sm:p-7"}>
      <p className={active ? "text-5xl font-black tracking-tight sm:text-6xl" : "text-5xl font-black tracking-tight text-slate-950 sm:text-6xl"}>{loading ? "…" : count}</p>
      <h2 className="mt-3 text-base font-black sm:text-xl">{title}</h2>
      <p className={active ? "mt-2 text-xs font-bold text-slate-300 sm:text-sm" : "mt-2 text-xs font-bold text-slate-400 sm:text-sm"}>{subtitle}</p>
    </button>
  );
}

function RangeTabs({ value, onChange }) {
  return (
    <div className="mt-4 grid grid-cols-3 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:inline-grid sm:min-w-96">
      {TIME_RANGES.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={value === option.key
            ? "rounded-lg bg-white px-2 py-2.5 text-xs font-black text-slate-950 shadow-sm sm:text-sm"
            : "rounded-lg px-2 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-950 sm:text-sm"}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function ReviewClientsNative() {
  const { user, profile } = useAuth();
  const clientId = profile?.clientId || "";
  const businessName = profile?.businessName || "Your Business";
  const [contacted, setContacted] = useState([]);
  const [acceptedByCollection, setAcceptedByCollection] = useState({});
  const [loaded, setLoaded] = useState(new Set());
  const [busy, setBusy] = useState(new Set());
  const [activeSection, setActiveSection] = useState(null);
  const [activeRange, setActiveRange] = useState("all");
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setError("This account does not have a business assigned yet.");
      return undefined;
    }

    setLoaded(new Set());
    setContacted([]);
    setAcceptedByCollection({});

    const unsubscribeContacted = onSnapshot(
      collection(db, "ocmClients", clientId, "contactedMe"),
      (snapshot) => {
        setContacted(snapshot.docs.map((item) => normalizeRow(item.id, item.data(), "contactedMe")).sort((a, b) => rowTime(b) - rowTime(a)));
        setLoaded((current) => new Set(current).add("contactedMe"));
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load people who contacted you.");
      }
    );

    const acceptedUnsubscribers = ACCEPTED_COLLECTIONS.map((collectionKey) => onSnapshot(
      collection(db, "ocmClients", clientId, collectionKey),
      (snapshot) => {
        setAcceptedByCollection((current) => ({
          ...current,
          [collectionKey]: snapshot.docs.map((item) => normalizeRow(item.id, item.data(), collectionKey)),
        }));
        setLoaded((current) => new Set(current).add(collectionKey));
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Could not load your clients.");
      }
    ));

    return () => {
      unsubscribeContacted();
      acceptedUnsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [clientId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("section") === "contacted") {
      setActiveSection("contacted");
      markLeadsViewed(user);
    }
  }, [user]);

  const clients = useMemo(() => (
    ACCEPTED_COLLECTIONS
      .flatMap((collectionKey) => acceptedByCollection[collectionKey] || [])
      .sort((a, b) => rowTime(b) - rowTime(a))
  ), [acceptedByCollection]);

  const filteredContacted = useMemo(
    () => contacted.filter((row) => insideRange(row, activeRange, "contacted")),
    [activeRange, contacted]
  );
  const filteredClients = useMemo(
    () => clients.filter((row) => insideRange(row, activeRange, "clients")),
    [activeRange, clients]
  );

  const contactedLoaded = loaded.has("contactedMe");
  const clientsLoaded = ACCEPTED_COLLECTIONS.every((collectionKey) => loaded.has(collectionKey));
  const rangeLabel = TIME_RANGES.find((item) => item.key === activeRange)?.label || "All Time";

  function markBusy(key, value) {
    setBusy((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function acceptLead(row, includeContact) {
    const key = `accept:${row.id}`;
    if (!clientId || busy.has(key)) return;
    markBusy(key, true);
    setNotice("");
    setError("");

    try {
      const { id, collectionKey, ...data } = row;
      const batch = writeBatch(db);
      batch.set(doc(db, "ocmClients", clientId, "clients", row.id), {
        ...data,
        currentStage: "clients",
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.delete(doc(db, "ocmClients", clientId, "contactedMe", row.id));
      await batch.commit();

      if (!includeContact) {
        setNotice(`${row.Name || "Client"} was accepted. Confirm the requested date separately when it works for you.`);
        return;
      }

      const contactResult = await openContactEditor(row, businessName);
      if (!contactResult.ok) {
        setNotice(`${row.Name || "Client"} was accepted, but the phone contact editor could not be opened.`);
      } else if (contactResult.editor) {
        setNotice(`${row.Name || "Client"} was accepted. Review the prefilled contact and tap Save in your Contacts app.`);
      } else {
        setNotice(`${row.Name || "Client"} was accepted and added to contacts.`);
      }
    } catch (acceptError) {
      console.error(acceptError);
      setError("Could not accept this client.");
    } finally {
      markBusy(key, false);
    }
  }

  async function addPhoneContact(row) {
    const key = `contact:${row.collectionKey}:${row.id}`;
    if (busy.has(key)) return;
    markBusy(key, true);
    setNotice("");
    setError("");
    try {
      const result = await openContactEditor(row, businessName);
      if (!result.ok) setError("The phone contact editor could not be opened.");
      else if (result.editor) setNotice("The contact is prefilled. Tap Save in your Contacts app.");
      else setNotice("The contact was added to your phone.");
    } finally {
      markBusy(key, false);
    }
  }

  async function confirmDate(row) {
    const key = `date:${row.collectionKey}:${row.id}`;
    if (busy.has(key)) return;
    markBusy(key, true);
    setNotice("");
    setError("");
    try {
      const result = await openCalendarEditor(row, clientId, businessName);
      if (!result.ok && result.reason === "missing-date") {
        setEditing(row);
        setNotice("Add the estimate date and time, then tap Confirm Date again.");
      } else if (!result.ok) {
        setError("The phone calendar could not be opened. Check calendar permission in phone settings.");
      } else if (result.native) {
        setNotice("The calendar event is prefilled. Review it and tap Save to confirm the date.");
      } else {
        setNotice("A calendar event file was created.");
      }
    } finally {
      markBusy(key, false);
    }
  }

  async function removeRow(row) {
    const label = row.Name || row.Address || "this record";
    if (!window.confirm(`Delete ${label}? This permanently removes the client record and cannot be undone.`)) return;
    if (!window.confirm(`Final warning: permanently delete ${label}?`)) return;

    const key = `delete:${row.collectionKey}:${row.id}`;
    if (!clientId || busy.has(key)) return;
    markBusy(key, true);
    setNotice("");
    setError("");

    try {
      await deleteDoc(doc(db, "ocmClients", clientId, row.collectionKey, row.id));
      if (viewing?.id === row.id) setViewing(null);
      if (editing?.id === row.id) setEditing(null);
      setNotice(`${label} was deleted.`);
    } catch (deleteError) {
      console.error(deleteError);
      setError(`Could not delete ${label}.`);
    } finally {
      markBusy(key, false);
    }
  }

  function toggleSection(section) {
    const next = activeSection === section ? null : section;
    setActiveSection(next);
    if (next) setActiveRange("all");
    if (next === "contacted") markLeadsViewed(user);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 sm:px-5 sm:py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 sm:text-xs">{businessName}</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:mt-3 sm:text-4xl md:text-5xl">Clients</h1>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}

        <section className="grid grid-cols-2 gap-3 sm:gap-5">
          <SummaryCard title="Contacted Me" subtitle="Tap to review new callers" count={contacted.length} loading={!contactedLoaded} active={activeSection === "contacted"} onClick={() => toggleSection("contacted")} />
          <SummaryCard title="Clients" subtitle="Tap to review accepted clients" count={clients.length} loading={!clientsLoaded} active={activeSection === "clients"} onClick={() => toggleSection("clients")} />
        </section>

        {activeSection === "contacted" && (
          <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">New callers</p>
                <h2 className="mt-1 text-xl font-black sm:text-2xl">Contacted Me <span className="text-slate-400">({filteredContacted.length})</span></h2>
              </div>
              <button type="button" onClick={() => setActiveSection(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Close</button>
            </div>

            <RangeTabs value={activeRange} onChange={setActiveRange} />

            <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-0.5">
              {!contactedLoaded && <EmptyState>Loading callers…</EmptyState>}
              {contactedLoaded && filteredContacted.length === 0 && <EmptyState>No callers found for {rangeLabel.toLowerCase()}.</EmptyState>}
              {filteredContacted.map((row) => {
                const accepting = busy.has(`accept:${row.id}`);
                const deleting = busy.has(`delete:${row.collectionKey}:${row.id}`);
                return (
                  <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <button type="button" onClick={() => setViewing(row)} className="w-full text-left">
                      <h3 className="truncate text-base font-black">{row.Name || "Unnamed caller"}</h3>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
                      <p className="mt-1 truncate text-xs font-bold text-slate-400">Requested: {displayRequestedDate(row)}</p>
                    </button>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button type="button" disabled={accepting} onClick={() => acceptLead(row, false)} className="rounded-xl bg-slate-950 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Accept</button>
                      <button type="button" disabled={accepting} onClick={() => acceptLead(row, true)} className="rounded-xl bg-green-700 px-3 py-3 text-xs font-black text-white disabled:opacity-50">Accept + Contact</button>
                      <button type="button" onClick={() => setViewing(row)} className="rounded-xl border border-slate-300 px-3 py-3 text-xs font-black">View</button>
                      <button type="button" disabled={deleting} onClick={() => removeRow(row)} className="rounded-xl border border-red-300 px-3 py-3 text-xs font-black text-red-700 disabled:opacity-50">Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {activeSection === "clients" && (
          <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-6 sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Accepted people</p>
                <h2 className="mt-1 text-xl font-black sm:text-2xl">Clients <span className="text-slate-400">({filteredClients.length})</span></h2>
              </div>
              <button type="button" onClick={() => setActiveSection(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Close</button>
            </div>

            <RangeTabs value={activeRange} onChange={setActiveRange} />

            <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto pr-0.5">
              {!clientsLoaded && <EmptyState>Loading clients…</EmptyState>}
              {clientsLoaded && filteredClients.length === 0 && <EmptyState>No clients found for {rangeLabel.toLowerCase()}.</EmptyState>}
              {filteredClients.map((row) => {
                const deleting = busy.has(`delete:${row.collectionKey}:${row.id}`);
                const contactBusy = busy.has(`contact:${row.collectionKey}:${row.id}`);
                const dateBusy = busy.has(`date:${row.collectionKey}:${row.id}`);
                return (
                  <article key={`${row.collectionKey}:${row.id}`} className="rounded-2xl border border-slate-200 p-4">
                    <button type="button" onClick={() => setViewing(row)} className="w-full text-left">
                      <h3 className="truncate text-base font-black">{row.Name || "Unnamed client"}</h3>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
                      <p className="mt-1 truncate text-xs font-bold text-slate-400">Requested: {displayRequestedDate(row)}</p>
                    </button>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <button type="button" onClick={() => setViewing(row)} className="rounded-xl border border-slate-300 px-2 py-3 text-[11px] font-black">View</button>
                      <button type="button" disabled={contactBusy} onClick={() => addPhoneContact(row)} className="rounded-xl border border-green-300 px-2 py-3 text-[11px] font-black text-green-800 disabled:opacity-50">Contact</button>
                      <button type="button" disabled={dateBusy} onClick={() => confirmDate(row)} className="rounded-xl bg-blue-700 px-2 py-3 text-[11px] font-black text-white disabled:opacity-50">Confirm Date</button>
                      <button type="button" onClick={() => setEditing(row)} className="rounded-xl bg-slate-950 px-2 py-3 text-[11px] font-black text-white">Edit</button>
                      <button type="button" disabled={deleting} onClick={() => removeRow(row)} className="col-span-2 rounded-xl border border-red-300 px-2 py-3 text-[11px] font-black text-red-700 disabled:opacity-50">Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {viewing && <ViewModal row={viewing} onClose={() => setViewing(null)} onContact={() => addPhoneContact(viewing)} onDate={() => confirmDate(viewing)} />}
      {editing && <EditModal row={editing} clientId={clientId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Client changes were saved."); }} />}
    </main>
  );
}
