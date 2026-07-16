"use client";

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

const CLIENT_ID = "tabor-painting";
const ACCEPTED_COLLECTIONS = ["preClients", "clients", "postClients"];

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function normalizeRow(id, data, collectionKey) {
  return {
    ...data,
    id,
    collectionKey,
    Name: firstValue(data.Name, data.name, data.fullName),
    Phone: firstValue(data.Phone, data.phone, data.phoneNumber, data.contact),
    Email: firstValue(data.Email, data.email),
    Address: firstValue(data.Address, data.address),
    Job: firstValue(data.Job, data.job, data.service, data.projectType),
    Notes: firstValue(data.Notes, data.notes, data.message),
    EstimateDate: firstValue(data.EstimateDate, data.estimateDate, data.PreferredDay, data.preferredDay, data.estimateDay),
    EstimateTime: firstValue(data.EstimateTime, data.estimateTime, data.PreferredTime, data.preferredTime),
  };
}

function rowTime(row) {
  const value = row.createdAt || row.acceptedAt || row.updatedAt;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  const parsed = new Date(value || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
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

function calendarDate(row) {
  const rawDate = String(row.EstimateDate || "").trim();
  if (!rawDate) return null;

  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [year, month, day] = rawDate.split("-").map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(rawDate);
  }

  if (Number.isNaN(date.getTime())) return null;

  const timeMatch = String(row.EstimateTime || "").match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  } else {
    date.setHours(9, 0, 0, 0);
  }
  return date;
}

function addCalendarFile(row) {
  const start = calendarDate(row);
  if (!start) return false;

  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const title = `Estimate - ${row.Name || row.Address || "New client"}`;
  const description = [
    row.Job && `Job: ${row.Job}`,
    row.Phone && `Phone: ${row.Phone}`,
    row.Email && `Email: ${row.Email}`,
    row.Notes && `Notes: ${row.Notes}`,
  ].filter(Boolean).join("\n");
  const uid = `${row.id}-${Date.now()}@tabor-painting-ocm`;
  const now = new Date();

  const contents = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tabor Painting//Client Collection Center//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${calendarStamp(now)}`,
    `DTSTART:${calendarStamp(start)}`,
    `DTEND:${calendarStamp(end)}`,
    `SUMMARY:${escapeCalendarText(title)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    `LOCATION:${escapeCalendarText(row.Address)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  downloadFile(`${safeFileName(row.Name || row.Address)}-estimate.ics`, contents, "text/calendar;charset=utf-8");
  return true;
}

function addContactFile(row) {
  if (!row.Name && !row.Phone && !row.Email) return false;

  const name = row.Name || row.Address || "Tabor Painting Client";
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

function Detail({ label, value, wide = false }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="fixed inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div className="relative mx-auto my-8 max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function ViewModal({ row, onClose }) {
  return (
    <Modal title="Client details" onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Client details</p>
          <h2 className="mt-2 text-2xl font-black">{row.Name || "Unnamed caller"}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-100">Close</button>
      </div>
      <div className="grid gap-5 p-6 sm:grid-cols-2">
        <Detail label="Phone" value={row.Phone} />
        <Detail label="Email" value={row.Email} />
        <Detail label="Address" value={row.Address} wide />
        <Detail label="Job type" value={row.Job} />
        <Detail label="Estimate date" value={row.EstimateDate} />
        <Detail label="Estimate time" value={row.EstimateTime} />
        <Detail label="Notes" value={row.Notes} wide />
      </div>
    </Modal>
  );
}

function EditModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    Name: row.Name || "",
    Phone: row.Phone || "",
    Email: row.Email || "",
    Address: row.Address || "",
    Job: row.Job || "",
    EstimateDate: row.EstimateDate || "",
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
      await setDoc(doc(db, "ocmClients", CLIENT_ID, row.collectionKey || "clients", row.id), {
        ...form,
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
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Client record</p>
            <h2 className="mt-2 text-2xl font-black">Edit client</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          {fields.map(([field, label, type]) => (
            <label key={field} className={field === "Address" ? "sm:col-span-2" : ""}>
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
              <input
                type={type}
                value={form[field]}
                onChange={(event) => update(field, event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-950"
              />
            </label>
          ))}
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Notes</span>
            <textarea
              rows={4}
              value={form.Notes}
              onChange={(event) => update("Notes", event.target.value)}
              className="w-full rounded-xl border border-slate-300 p-3 outline-none focus:border-slate-950"
            />
          </label>
          {error && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 p-6">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold hover:bg-slate-100">Cancel</button>
          <button disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save client"}</button>
        </div>
      </form>
    </Modal>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">{children}</div>;
}

export default function ReviewClients() {
  const [contacted, setContacted] = useState([]);
  const [acceptedByCollection, setAcceptedByCollection] = useState({});
  const [loaded, setLoaded] = useState(new Set());
  const [busy, setBusy] = useState(new Set());
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribeContacted = onSnapshot(
      collection(db, "ocmClients", CLIENT_ID, "contactedMe"),
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
      collection(db, "ocmClients", CLIENT_ID, collectionKey),
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
  }, []);

  const clients = useMemo(() => (
    ACCEPTED_COLLECTIONS
      .flatMap((collectionKey) => acceptedByCollection[collectionKey] || [])
      .sort((a, b) => rowTime(b) - rowTime(a))
  ), [acceptedByCollection]);

  const contactedLoaded = loaded.has("contactedMe");
  const clientsLoaded = ACCEPTED_COLLECTIONS.every((collectionKey) => loaded.has(collectionKey));

  function markBusy(key, value) {
    setBusy((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function acceptLead(row, includeContacts) {
    const key = `accept:${row.id}`;
    if (busy.has(key)) return;
    markBusy(key, true);
    setNotice("");
    setError("");

    try {
      const { id, collectionKey, ...data } = row;
      const batch = writeBatch(db);
      batch.set(doc(db, "ocmClients", CLIENT_ID, "clients", row.id), {
        ...data,
        currentStage: "clients",
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.delete(doc(db, "ocmClients", CLIENT_ID, "contactedMe", row.id));
      await batch.commit();

      const calendarAdded = addCalendarFile(row);
      const contactAdded = includeContacts ? addContactFile(row) : true;

      if (!calendarAdded) {
        setNotice(`${row.Name || "Client"} was accepted. No usable estimate date was found, so the calendar file was not created.`);
      } else if (!contactAdded) {
        setNotice(`${row.Name || "Client"} was accepted and added to the calendar. There was not enough contact information to create a contact file.`);
      } else {
        setNotice(includeContacts
          ? `${row.Name || "Client"} was accepted. Calendar and contact files are ready.`
          : `${row.Name || "Client"} was accepted and the calendar file is ready.`);
      }
    } catch (acceptError) {
      console.error(acceptError);
      setError("Could not accept this client.");
    } finally {
      markBusy(key, false);
    }
  }

  async function removeRow(row) {
    const label = row.Name || row.Address || "this record";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    const key = `delete:${row.collectionKey}:${row.id}`;
    if (busy.has(key)) return;
    markBusy(key, true);
    setNotice("");
    setError("");

    try {
      await deleteDoc(doc(db, "ocmClients", CLIENT_ID, row.collectionKey, row.id));
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

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Tabor Painting</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Review My Clients</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">Accept new callers, save their estimate, and keep one simple list of clients.</p>
        </header>

        {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
        {notice && <div className="mb-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-800">{notice}</div>}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">New callers</p>
              <h2 className="mt-2 text-3xl font-black">Contacted Me</h2>
            </div>
            <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white">{contacted.length}</span>
          </div>

          <div className="mt-5 space-y-3">
            {!contactedLoaded && <EmptyState>Loading callers…</EmptyState>}
            {contactedLoaded && contacted.length === 0 && <EmptyState>No new callers are waiting.</EmptyState>}
            {contacted.map((row) => {
              const accepting = busy.has(`accept:${row.id}`);
              const deleting = busy.has(`delete:${row.collectionKey}:${row.id}`);
              return (
                <article key={row.id} className="rounded-2xl border border-slate-200 p-4 md:p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-black">{row.Name || "Unnamed caller"}</h3>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setViewing(row)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-100">View</button>
                      <button type="button" disabled={accepting} onClick={() => acceptLead(row, false)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Accept + Calendar</button>
                      <button type="button" disabled={accepting} onClick={() => acceptLead(row, true)} className="rounded-xl bg-green-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Accept + Calendar + Contacts</button>
                      <button type="button" disabled={deleting} onClick={() => removeRow(row)} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Delete</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Accepted people</p>
              <h2 className="mt-2 text-3xl font-black">Clients</h2>
            </div>
            <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white">{clients.length}</span>
          </div>

          <div className="mt-5 space-y-3">
            {!clientsLoaded && <EmptyState>Loading clients…</EmptyState>}
            {clientsLoaded && clients.length === 0 && <EmptyState>No accepted clients yet.</EmptyState>}
            {clients.map((row) => {
              const deleting = busy.has(`delete:${row.collectionKey}:${row.id}`);
              return (
                <article key={`${row.collectionKey}:${row.id}`} className="rounded-2xl border border-slate-200 p-4 md:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-black">{row.Name || "Unnamed client"}</h3>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setViewing(row)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-100">View</button>
                      <button type="button" onClick={() => setEditing(row)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Edit</button>
                      <button type="button" disabled={deleting} onClick={() => removeRow(row)} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Delete</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {viewing && <ViewModal row={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Client changes were saved."); }} />}
    </main>
  );
}
