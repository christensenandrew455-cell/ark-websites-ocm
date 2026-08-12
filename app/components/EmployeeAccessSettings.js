"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BackButton from "./BackButton";
import { useAuth } from "./AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";

const VISIBILITY_LABELS = {
  name: "Lead name",
  phone: "Phone number",
  address: "Job address",
  job: "Requested work",
  requestedTime: "Requested date and time",
  notes: "Client and business notes",
};

const DIRECTORY_LABELS = {
  name: "Employee name",
  email: "Employee email",
  phone: "Employee phone number",
};

const FIELD_LABEL_CLASS = "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs";

async function employeeApi(user, options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch("/api/business/employees", {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not update employee access.");
  return data;
}

export default function EmployeeAccessSettings({ onBack = () => {}, embedded = false }) {
  const { user, profile } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [visibility, setVisibility] = useState({});
  const [directoryVisibility, setDirectoryVisibility] = useState({});
  const [employeeMessagingEnabled, setEmployeeMessagingEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const accessRef = useRef({ visibility: {}, directoryVisibility: {}, employeeMessagingEnabled: false });
  const saveQueueRef = useRef(Promise.resolve());
  const queuedSavesRef = useRef(0);

  const load = useCallback(async () => {
    if (!user || profile?.employeesEnabled !== true) return;
    try {
      const data = await employeeApi(user);
      const nextAccess = {
        visibility: data.employeeVisibility || {},
        directoryVisibility: data.employeeDirectoryVisibility || {},
        employeeMessagingEnabled: data.employeeMessagingEnabled === true,
      };
      accessRef.current = nextAccess;
      setWorkspace(data);
      setVisibility(nextAccess.visibility);
      setDirectoryVisibility(nextAccess.directoryVisibility);
      setEmployeeMessagingEnabled(nextAccess.employeeMessagingEnabled);
      setError("");
    } catch (loadError) {
      setError(ownerFacingError(loadError));
    }
  }, [profile?.employeesEnabled, user]);

  useEffect(() => { load(); }, [load]);

  function queueSave(nextAccess) {
    if (!user) return;
    queuedSavesRef.current += 1;
    setSaving(true);
    setError("");
    saveQueueRef.current = saveQueueRef.current
      .catch(() => null)
      .then(() => employeeApi(user, {
        method: "POST",
        body: JSON.stringify({ action: "access", ...nextAccess }),
      }))
      .catch((saveError) => setError(ownerFacingError(saveError)))
      .finally(() => {
        queuedSavesRef.current -= 1;
        if (queuedSavesRef.current === 0) setSaving(false);
      });
  }

  function applyAccess(nextAccess) {
    accessRef.current = nextAccess;
    setVisibility(nextAccess.visibility);
    setDirectoryVisibility(nextAccess.directoryVisibility);
    setEmployeeMessagingEnabled(nextAccess.employeeMessagingEnabled);
    queueSave(nextAccess);
  }

  function updateMessaging(checked) {
    applyAccess({ ...accessRef.current, employeeMessagingEnabled: checked });
  }

  function updateVisibility(key, checked) {
    applyAccess({
      ...accessRef.current,
      visibility: { ...accessRef.current.visibility, [key]: checked },
    });
  }

  function updateDirectoryVisibility(key, checked) {
    applyAccess({
      ...accessRef.current,
      directoryVisibility: { ...accessRef.current.directoryVisibility, [key]: checked },
    });
  }

  if (profile?.employeesEnabled !== true) {
    if (embedded) return null;
    return <main className="min-h-screen bg-slate-200 px-3 py-4 text-slate-950 sm:p-6 md:p-8"><div className="mx-auto max-w-4xl"><BackButton onClick={onBack} /><div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">Turn on Employees in Customization first.</div></div></main>;
  }

  const controls = <>
    <label className={workspace?.messagesEnabled ? "flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4" : "flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-100 p-4 opacity-60"}>
      <span className={FIELD_LABEL_CLASS}>Messages for employees</span>
      <input type="checkbox" disabled={!workspace?.messagesEnabled} checked={employeeMessagingEnabled} onChange={(event) => updateMessaging(event.target.checked)} className="h-5 w-5 accent-slate-950" />
    </label>

    <p className={`mt-6 ${FIELD_LABEL_CLASS}`}>Shown information for employees</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {Object.entries(VISIBILITY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3"><span className={FIELD_LABEL_CLASS}>{label}</span><input type="checkbox" checked={visibility[key] === true} onChange={(event) => updateVisibility(key, event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>)}
    </div>

    <p className={`mt-6 ${FIELD_LABEL_CLASS}`}>Employee directory</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {Object.entries(DIRECTORY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3"><span className={FIELD_LABEL_CLASS}>{label}</span><input type="checkbox" checked={directoryVisibility[key] === true} onChange={(event) => updateDirectoryVisibility(key, event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>)}
    </div>
  </>;

  if (embedded) {
    return <section className="border-t border-slate-200 pt-6"><div className="flex items-center justify-between gap-3"><span className={FIELD_LABEL_CLASS}>Employee access</span>{saving && <span className="text-xs font-bold text-slate-400">Saving…</span>}</div>{error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}<div className="mt-4">{controls}</div></section>;
  }

  return (
    <main className="min-h-screen bg-slate-200 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <BackButton onClick={onBack} />
        <h1 className="mt-5 text-4xl font-black tracking-tight">Employee Access Settings</h1>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-300/70 p-3 shadow-inner sm:p-5"><div className="rounded-3xl border border-slate-300 bg-slate-50 p-4 shadow-sm sm:p-6">{controls}</div></section>
      </div>
    </main>
  );
}
