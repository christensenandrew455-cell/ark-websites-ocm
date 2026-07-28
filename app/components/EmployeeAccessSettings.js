"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BackButton from "./BackButton";
import { useAuth } from "./AuthProvider";
import UnsavedChangesPrompt, { requestUnsavedNavigation } from "./UnsavedChangesPrompt";

const VISIBILITY_LABELS = {
  name: "Lead name",
  phone: "Phone number",
  address: "Job address",
  job: "Requested work",
  requestedTime: "Requested date and time",
  notes: "Additional notes",
};

const DIRECTORY_LABELS = {
  name: "Employee name",
  email: "Employee email",
  phone: "Employee phone number",
};

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
  const [savedAccess, setSavedAccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const currentAccess = useMemo(() => ({ visibility, directoryVisibility, employeeMessagingEnabled }), [directoryVisibility, employeeMessagingEnabled, visibility]);
  const dirty = Boolean(savedAccess && JSON.stringify(currentAccess) !== JSON.stringify(savedAccess));

  const load = useCallback(async () => {
    if (!user || profile?.employeesEnabled !== true) return;
    try {
      const data = await employeeApi(user);
      const nextAccess = {
        visibility: data.employeeVisibility || {},
        directoryVisibility: data.employeeDirectoryVisibility || {},
        employeeMessagingEnabled: data.employeeMessagingEnabled === true,
      };
      setWorkspace(data);
      setVisibility(nextAccess.visibility);
      setDirectoryVisibility(nextAccess.directoryVisibility);
      setEmployeeMessagingEnabled(nextAccess.employeeMessagingEnabled);
      setSavedAccess(nextAccess);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [profile?.employeesEnabled, user]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!user || saving || !dirty) return true;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const result = await employeeApi(user, {
        method: "POST",
        body: JSON.stringify({ action: "access", visibility, directoryVisibility, employeeMessagingEnabled }),
      });
      const nextAccess = {
        visibility: result.visibility || visibility,
        directoryVisibility: result.directoryVisibility || directoryVisibility,
        employeeMessagingEnabled: result.employeeMessagingEnabled === true,
      };
      setVisibility(nextAccess.visibility);
      setDirectoryVisibility(nextAccess.directoryVisibility);
      setEmployeeMessagingEnabled(nextAccess.employeeMessagingEnabled);
      setSavedAccess(nextAccess);
      setNotice("Employee access settings saved.");
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!savedAccess) return;
    setVisibility(savedAccess.visibility);
    setDirectoryVisibility(savedAccess.directoryVisibility);
    setEmployeeMessagingEnabled(savedAccess.employeeMessagingEnabled);
  }

  function goBack() {
    requestUnsavedNavigation("Settings", onBack);
  }

  if (profile?.employeesEnabled !== true) {
    if (embedded) return null;
    return <main className="min-h-screen bg-slate-200 px-3 py-4 text-slate-950 sm:p-6 md:p-8"><div className="mx-auto max-w-4xl"><BackButton onClick={onBack} /><div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">Turn on Employees in Customization first.</div></div></main>;
  }

  const controls = <>
    <label className={workspace?.messagesEnabled ? "flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4" : "flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-100 p-4 opacity-60"}>
      <span className="text-sm font-black">Messages for Employees</span>
      <input type="checkbox" disabled={!workspace?.messagesEnabled} checked={employeeMessagingEnabled} onChange={(event) => setEmployeeMessagingEnabled(event.target.checked)} className="h-5 w-5 accent-slate-950" />
    </label>

    <h4 className="mt-6 text-lg font-black">Lead Information</h4>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {Object.entries(VISIBILITY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3"><span className="text-sm font-bold text-slate-700">{label}</span><input type="checkbox" checked={visibility[key] === true} onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" /></label>)}
    </div>

    <h4 className="mt-6 text-lg font-black">Employee Directory</h4>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {Object.entries(DIRECTORY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3"><span className="text-sm font-bold text-slate-700">{label}</span><input type="checkbox" checked={directoryVisibility[key] === true} onChange={(event) => setDirectoryVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" /></label>)}
    </div>

    <button type="button" disabled={saving || !dirty} onClick={save} className="mt-5 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{saving ? "Saving…" : "Save Employee Access"}</button>
  </>;

  if (embedded) {
    return <section className="mt-7 border-t border-slate-200 pt-7"><UnsavedChangesPrompt dirty={dirty} onSave={save} onDiscard={discard} /><h3 className="text-lg font-black">Employees</h3>{notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}{error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}<div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">{controls}</div></section>;
  }

  return (
    <main className="min-h-screen bg-slate-200 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <UnsavedChangesPrompt dirty={dirty} onSave={save} onDiscard={discard} />
      <div className="mx-auto max-w-4xl">
        <BackButton onClick={goBack} />
        <h1 className="mt-5 text-4xl font-black tracking-tight">Employee Access Settings</h1>
        {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-300/70 p-3 shadow-inner sm:p-5"><div className="rounded-3xl border border-slate-300 bg-slate-50 p-4 shadow-sm sm:p-6">{controls}</div></section>
      </div>
    </main>
  );
}
