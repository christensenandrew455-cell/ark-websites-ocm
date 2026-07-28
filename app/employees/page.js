"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import UnsavedChangesPrompt, { requestUnsavedNavigation } from "../components/UnsavedChangesPrompt";

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
  if (!response.ok) throw new Error(data.error || "Could not update employees.");
  return data;
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function WorkspaceCard({ children, id = undefined }) {
  return <section id={id} className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6">{children}</section>;
}

export default function EmployeesPage() {
  const { user, isOwner, profile, loading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [visibility, setVisibility] = useState({});
  const [directoryVisibility, setDirectoryVisibility] = useState({});
  const [employeeMessagingEnabled, setEmployeeMessagingEnabled] = useState(false);
  const [savedAccess, setSavedAccess] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const currentAccess = useMemo(() => ({ visibility, directoryVisibility, employeeMessagingEnabled }), [directoryVisibility, employeeMessagingEnabled, visibility]);
  const accessDirty = Boolean(savedAccess && JSON.stringify(currentAccess) !== JSON.stringify(savedAccess));

  const load = useCallback(async () => {
    if (!user || !isOwner || profile?.employeesEnabled !== true) return;
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
  }, [isOwner, profile?.employeesEnabled, user]);

  useEffect(() => {
    if (!loading) load();
  }, [load, loading]);

  async function saveAccess() {
    if (!user || busy || !accessDirty) return true;
    setBusy("access");
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
      setWorkspace((current) => current ? {
        ...current,
        employeeVisibility: nextAccess.visibility,
        employeeDirectoryVisibility: nextAccess.directoryVisibility,
        employeeMessagingEnabled: nextAccess.employeeMessagingEnabled,
      } : current);
      setNotice("Employee access settings were saved.");
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  function discardAccess() {
    if (!savedAccess) return;
    setVisibility(savedAccess.visibility);
    setDirectoryVisibility(savedAccess.directoryVisibility);
    setEmployeeMessagingEnabled(savedAccess.employeeMessagingEnabled);
  }

  function runAction(payload, message, label = "Continue") {
    if (!user || busy) return;
    const execute = async () => {
      setBusy(`${payload.action}:${payload.employeeUid || payload.recordId || "settings"}`);
      setNotice("");
      setError("");
      try {
        await employeeApi(user, { method: "POST", body: JSON.stringify(payload) });
        setNotice(message);
        await load();
      } catch (actionError) {
        setError(actionError.message);
      } finally {
        setBusy("");
      }
    };
    requestUnsavedNavigation(label, execute);
  }

  function deleteEmployee(employee) {
    const execute = () => {
      if (!window.confirm(`Permanently delete ${employee.name}'s employee account? Their assigned work will become unassigned.`)) return;
      runAction({ action: "delete", employeeUid: employee.uid }, `${employee.name} was deleted.`, "Employees");
    };
    requestUnsavedNavigation("Employees", execute);
  }

  if (loading || (isOwner && profile?.employeesEnabled && !workspace && !error)) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading employees…</main>;
  }
  if (!isOwner || profile?.employeesEnabled !== true) {
    return <main className="grid min-h-[70vh] place-items-center bg-slate-50 p-6"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">Turn on Employees in owner Settings to use this workspace.</div></main>;
  }

  const employees = workspace?.employees || [];
  const pendingEmployees = employees.filter((employee) => employee.status === "pending_owner_approval");
  const managedEmployees = employees.filter((employee) => employee.status !== "pending_owner_approval");
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const leads = workspace?.leads || [];

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <UnsavedChangesPrompt dirty={accessDirty} onSave={saveAccess} onDiscard={discardAccess} />
        <Link href="/" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black shadow-sm">← Dashboard</Link>
        <header className="mt-4 sm:mt-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Account workspace</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Employees</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Approve or delete employee accounts, control access, and assign work. Each active employee is {money(workspace?.perEmployeeCents || 500)} per billing period.</p>
        </header>
        {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <div className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5">
          <div className="space-y-4 sm:space-y-5">
            <WorkspaceCard>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Pending requests</p>
                <h2 className="mt-1 text-xl font-black sm:text-2xl">Accept Employees</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">Pending accounts are free until approved and active.</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {pendingEmployees.map((employee) => <article key={employee.uid} className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black">{employee.name}</h3><p className="mt-1 text-xs font-semibold text-slate-600">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-600">{employee.phone}</p><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={Boolean(busy)} onClick={() => runAction({ action: "approve", employeeUid: employee.uid }, `${employee.name} can now sign in.`, "Employees")} className="rounded-xl bg-green-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Approve</button><button disabled={Boolean(busy)} onClick={() => deleteEmployee(employee)} className="rounded-xl border border-red-300 bg-white px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div></article>)}
                {pendingEmployees.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No employee accounts are waiting for approval.</p>}
              </div>
            </WorkspaceCard>

            <WorkspaceCard>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Active and disabled</p>
                <h2 className="mt-1 text-xl font-black sm:text-2xl">Employees</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">{workspace?.activeEmployeeCount || 0} active · {money((workspace?.activeEmployeeCount || 0) * (workspace?.perEmployeeCents || 500))} this period</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {managedEmployees.map((employee) => <article key={employee.uid} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-black">{employee.name}</h3><p className="mt-1 truncate text-xs font-semibold text-slate-500">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-500">{employee.phone}</p></div><span className={employee.status === "active" ? "rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-black uppercase text-green-800" : "rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-700"}>{employee.status}</span></div><div className="mt-4 grid grid-cols-2 gap-2">{employee.status === "active" ? <button disabled={Boolean(busy)} onClick={() => runAction({ action: "disable", employeeUid: employee.uid }, `${employee.name} was disabled.`, "Employees")} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">Disable</button> : <button disabled={Boolean(busy)} onClick={() => runAction({ action: "activate", employeeUid: employee.uid }, `${employee.name} was reactivated.`, "Employees")} className="rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Reactivate</button>}<button disabled={Boolean(busy)} onClick={() => deleteEmployee(employee)} className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div></article>)}
                {managedEmployees.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No approved employees yet.</p>}
              </div>
            </WorkspaceCard>

            <WorkspaceCard id="visibility">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Employee access</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">Employee Access Settings</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">Choose whether employees can use Messages, what assigned lead information they can see, and what coworker contact information appears in employee Settings.</p>
              <label className={workspace?.messagesEnabled ? "mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" : "mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-100 p-4 opacity-60"}><span><strong className="block text-sm">Messages for Employees</strong><span className="text-xs text-slate-500">Allow approved employees to message only the leads assigned to them.{workspace?.messagesEnabled ? "" : " Turn on Messages in owner Settings first."}</span></span><input type="checkbox" disabled={!workspace?.messagesEnabled} checked={employeeMessagingEnabled} onChange={(event) => setEmployeeMessagingEnabled(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>
              <h3 className="mt-6 text-sm font-black">Assigned Lead Information</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(VISIBILITY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="text-sm font-bold text-slate-700">{label}</span><input type="checkbox" checked={visibility[key] === true} onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" /></label>)}</div>
              <h3 className="mt-6 text-sm font-black">Employee Directory Information</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">These three controls decide what employees can see about coworkers. There is no leaderboard or performance comparison.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(DIRECTORY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="text-sm font-bold text-slate-700">{label}</span><input type="checkbox" checked={directoryVisibility[key] === true} onChange={(event) => setDirectoryVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" /></label>)}</div>
              <button disabled={Boolean(busy) || !accessDirty} onClick={saveAccess} className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy === "access" ? "Saving…" : "Save Employee Access"}</button>
            </WorkspaceCard>

            <WorkspaceCard>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Lead routing</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">Assign Work</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">Assign each lead or client to one active employee.</p>
              <div className="mt-4 space-y-2">{leads.map((lead) => <article key={`${lead.collectionKey}:${lead.id}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_240px] sm:items-center"><div className="min-w-0"><h3 className="truncate text-sm font-black">{lead.name || "Unnamed lead"}</h3><p className="mt-1 truncate text-xs font-semibold text-slate-500">{lead.job || "Work not entered"}{lead.address ? ` · ${lead.address}` : ""}</p></div><select value={lead.assignedEmployeeUid || ""} disabled={Boolean(busy)} onChange={(event) => runAction({ action: "assign", collectionKey: lead.collectionKey, recordId: lead.id, employeeUid: event.target.value }, event.target.value ? "Work assignment updated." : "Work was unassigned.", "Employees")} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold outline-none focus:border-slate-950"><option value="">Unassigned</option>{activeEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name}</option>)}</select></article>)}{leads.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">No leads or clients are available to assign.</p>}</div>
            </WorkspaceCard>
          </div>
        </div>
      </div>
    </main>
  );
}
