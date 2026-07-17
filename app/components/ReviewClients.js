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
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

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
  if (timeMatch) date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  else date.setHours(9, 0, 0, 0);
  return date;
}

function addCalendarFile(row, clientId, businessName) {
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
  const uid = `${row.id}-${Date.now()}@${safeFileName(clientId)}-ocm`;
  const now = new Date();

  const contents = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${escapeCalendarText(businessName)}//Client Collection Center//EN`,
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

function Detail({ label, value, wide = false }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
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
      <div className="relative mx-auto my-3 max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl sm:my-8">
        {children}
      </div>
    </div>
  );
}

function ViewModal({ row, onClose }) {
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
        <Detail label="Estimate date" value={row.EstimateDate} />
        <Detail label="Estimate time" value={row.EstimateTime} />
        <Detail label="Notes" value={row.Notes} wide />
      </div>
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
      await setDoc(doc(db, "ocmClients", clientId, row.collectionKey || "clients", row.id), {
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
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-xs">Client record</p>
            <h2 className="mt-1 text-xl font-black sm:mt-2 sm:text-2xl">Edit client</h2>
          </div>
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
    <button
      type="button"
      onClick={onClick}
      className={active
        ? "rounded-2xl border border-slate-950 bg-slate-950 p-4 text-left text-white shadow-sm"
        : "rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.98]"}
    >
      <p className={active ? "text-4xl font-black" : "text-4xl font-black text-slate-950"}>{loading ? "…" : count}</p>
      <h2 className="mt-1 text-sm font-black">{title}</h2>
      <p className={active ? "mt-1 text-[10px] font-bold text-slate-300" : "mt-1 text-[10px] font-bold text-slate-400"}>{subtitle}</p>
    </button>
  );
}

export default function ReviewClients() {
  const { profile } = useAuth();
  const clientId = profile?.clientId || "";
  const businessName = profile?.businessName || "Your Business";
  const [contacted, setContacted] = useState([]);
  const [acceptedByCollection, setAcceptedByCollection] = useState({});
  const [loaded, setLoaded] = useState(new Set());
  const [busy, setBusy] = useState(new Set());
  const [activeSection, setActiveSection] = useState(null);
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

      const calendarAdded = addCalendarFile(row, clientId, businessName);
      const contactAdded = includeContacts ? addContactFile(row, businessName) : true;

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
    setActiveSection((current) => current === section ? null : section);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:px-5 sm:py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 sm:text-xs">{businessName}</p>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight sm:mt-3 sm:text-4xl md:text-5xl">Clients</h1>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}

        <section className="grid grid-cols-2 gap-3">
          <SummaryCard
            title="Contacted Me"
            subtitle="Tap to review new callers"
            count={contacted.length}
            loading={!contactedLoaded}
            active={activeSection === "contacted"}
            onClick={() => toggleSection("contacted")}
          />
          <SummaryCard
            title="Clients"
            subtitle="Tap to review accepted clients"
            count={clients.length}
            loading={!clientsLoaded}
            active={activeSection === "clients"}
            onClick={() => toggleSection("clients")}
          />
        </section>

        {activeSection === "contacted" && (
          <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">New callers</p>
                <h2 className="mt-1 text-xl font-black">Contacted Me</h2>
              </div>
              <button type="button" onClick={() => setActiveSection(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Close</button>
            </div>

            <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-0.5">
              {!contactedLoaded && <EmptyState>Loading callers…</EmptyState>}
              {contactedLoaded && contacted.length === 0 && <EmptyState>No new callers are waiting.</EmptyState>}
              {contacted.map((row) => {
                const accepting = busy.has(`accept:${row.id}`);
                const deleting = busy.has(`delete:${row.collectionKey}:${row.id}`);
                return (
                  <article key={row.id} className="rounded-xl border border-slate-200 p-3">
                    <button type="button" onClick={() => setViewing(row)} className="w-full text-left">
                      <h3 className="truncate text-sm font-black">{row.Name || "Unnamed caller"}</h3>
                      <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
                    </button>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" disabled={accepting} onClick={() => acceptLead(row, false)} className="rounded-lg bg-slate-950 px-2 py-2 text-[11px] font-black text-white disabled:opacity-50">Accept</button>
                      <button type="button" disabled={accepting} onClick={() => acceptLead(row, true)} className="rounded-lg bg-green-700 px-2 py-2 text-[11px] font-black text-white disabled:opacity-50">Accept + Contact</button>
                      <button type="button" onClick={() => setViewing(row)} className="rounded-lg border border-slate-300 px-2 py-2 text-[11px] font-black">View</button>
                      <button type="button" disabled={deleting} onClick={() => removeRow(row)} className="rounded-lg border border-red-300 px-2 py-2 text-[11px] font-black text-red-700 disabled:opacity-50">Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {activeSection === "clients" && (
          <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:mt-6 sm:rounded-3xl sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Accepted people</p>
                <h2 className="mt-1 text-xl font-black">Clients</h2>
              </div>
              <button type="button" onClick={() => setActiveSection(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Close</button>
            </div>

            <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-0.5">
              {!clientsLoaded && <EmptyState>Loading clients…</EmptyState>}
              {clientsLoaded && clients.length === 0 && <EmptyState>No accepted clients yet.</EmptyState>}
              {clients.map((row) => {
                const deleting = busy.has(`delete:${row.collectionKey}:${row.id}`);
                return (
                  <article key={`${row.collectionKey}:${row.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                    <button type="button" onClick={() => setViewing(row)} className="min-w-0 flex-1 text-left">
                      <h3 className="truncate text-sm font-black">{row.Name || "Unnamed client"}</h3>
                      <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{row.Job || "Service not entered"}{row.Address ? ` · ${row.Address}` : ""}</p>
                    </button>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => setViewing(row)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-black">View</button>
                      <button type="button" onClick={() => setEditing(row)} className="rounded-lg bg-slate-950 px-2.5 py-2 text-[11px] font-black text-white">Edit</button>
                      <button type="button" disabled={deleting} onClick={() => removeRow(row)} className="rounded-lg border border-red-300 px-2.5 py-2 text-[11px] font-black text-red-700 disabled:opacity-50">Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {viewing && <ViewModal row={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditModal row={editing} clientId={clientId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Client changes were saved."); }} />}
    </main>
  );
}
