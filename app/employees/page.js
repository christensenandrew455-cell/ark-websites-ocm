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

function SectionButton({ active, value, title, description, onClick, wide = false }) {
  const className = active
    ? "rounded-3xl border border-slate-900 bg-slate-900 p-5 text-left text-white shadow-sm transition active:scale-[0.99]"
    : "rounded-3xl border border-slate-300 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]";
  return (
    <button type="button" onClick={onClick} className={`${wide ? "min-h-28 w-full" : "min-h-32 w-full"} ${className}`}>
      <p className={wide ? "text-2xl font-black" : "text-3xl font-black"}>{value}</p>
      <h2 className="mt-2 text-sm font-black sm:text-lg">{title}</h2>
      <p className="mt-1 text-[10px] font-semibold opacity-60 sm:text-xs">{description}</p>
    </button>
  );
}

export default function EmployeesPage() {
  const { user, isOwner, profile, loading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [visibility, setVisibility] = useState({});
  const [directoryVisibility, setDirectoryVisibility] = useState({});
  const [employeeMessagingEnabled, setEmployeeMessagingEnabled] = useState(false);
  const [savedAccess, setSavedAccess] = useState(null);
  const [activeSection, setActiveSection] = useState("");
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
      setBusy(`${payload.action}:${payload.employeeUid || "settings"}`);
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

  function toggleSection(section) {
    requestUnsavedNavigation("Employees", () => setActiveSection((current) => current === section ? "" : section));
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
  const assignedLeads = leads.filter((lead) => lead.assignedEmployeeUid);
  const unassignedLeads = leads.filter((lead) => !lead.assignedEmployeeUid);

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <UnsavedChangesPrompt dirty={accessDirty} onSave={saveAccess} onDiscard={discardAccess} />
        <Link href="/" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black shadow-sm">← Dashboard</Link>
        <header className="mt-4 sm:mt-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Account workspace</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Employees</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Approve or delete employee accounts, control employee access, and review who is connected to each lead. Each active employee is {money(workspace?.perEmployeeCents || 500)} per billing period.</p>
        </header>
        {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-5">
            <SectionButton active={activeSection === "accounts"} value={employees.length} title="Accounts" description="Approve and manage employees" onClick={() => toggleSection("accounts")} />
            <SectionButton active={activeSection === "connections"} value={assignedLeads.length} title="Connections" description="Employees connected to work" onClick={() => toggleSection("connections")} />
          </div>
          <div className="mt-3 sm:mt-5">
            <SectionButton wide active={activeSection === "access"} value={employeeMessagingEnabled ? "Messages On" : "Messages Off"} title="Employee Access Settings" description="Messages, lead information, and coworker visibility" onClick={() => toggleSection("access")} />
          </div>

          {activeSection && <div className="mt-4 border-t border-slate-300 pt-4 sm:mt-5 sm:pt-5">
            <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black">{activeSection === "accounts" ? "Employee Accounts" : activeSection === "access" ? "Employee Access Settings" : "Employee Connections"}</h2><button type="button" onClick={() => toggleSection(activeSection)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black">Close</button></div>

            {activeSection === "accounts" && <div className="mt-4 space-y-4">
              <section className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Pending requests</p><h3 className="mt-1 text-xl font-black">Accept Employees</h3><p className="mt-1 text-xs font-semibold text-slate-500">Pending accounts are free until approved and active.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{pendingEmployees.map((employee) => <article key={employee.uid} className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h4 className="font-black">{employee.name}</h4><p className="mt-1 text-xs font-semibold text-slate-600">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-600">{employee.phone}</p><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={Boolean(busy)} onClick={() => runAction({ action: "approve", employeeUid: employee.uid }, `${employee.name} can now sign in.`, "Employees")} className="rounded-xl bg-green-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Approve</button><button disabled={Boolean(busy)} onClick={() => deleteEmployee(employee)} className="rounded-xl border border-red-300 bg-white px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div></article>)}{pendingEmployees.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No employee accounts are waiting for approval.</p>}</div></section>
              <section className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Active and disabled</p><h3 className="mt-1 text-xl font-black">Employees</h3><p className="mt-1 text-xs font-semibold text-slate-500">{workspace?.activeEmployeeCount || 0} active · {money((workspace?.activeEmployeeCount || 0) * (workspace?.perEmployeeCents || 500))} this period</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{managedEmployees.map((employee) => <article key={employee.uid} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate font-black">{employee.name}</h4><p className="mt-1 truncate text-xs font-semibold text-slate-500">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-500">{employee.phone}</p></div><span className={employee.status === "active" ? "rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-black uppercase text-green-800" : "rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-700"}>{employee.status}</span></div><div className="mt-4 grid grid-cols-2 gap-2">{employee.status === "active" ? <button disabled={Boolean(busy)} onClick={() => runAction({ action: "disable", employeeUid: employee.uid }, `${employee.name} was disabled.`, "Employees")} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-700 disabled:opacity-50">Disable</button> : <button disabled={Boolean(busy)} onClick={() => runAction({ action: "activate", employeeUid: employee.uid }, `${employee.name} was reactivated.`, "Employees")} className="rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Reactivate</button>}<button disabled={Boolean(busy)} onClick={() => deleteEmployee(employee)} className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div></article>)}{managedEmployees.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No approved employees yet.</p>}</div></section>
            </div>}

            {activeSection === "access" && <section id="visibility" className="mt-4 rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6"><p className="text-xs leading-5 text-slate-500">Choose whether employees can use Messages, what assigned lead information they can see, and what coworker contact information appears in employee Settings.</p><label className={workspace?.messagesEnabled ? "mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" : "mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-100 p-4 opacity-60"}><span><strong className="block text-sm">Messages for Employees</strong><span className="text-xs text-slate-500">Allow approved employees to message only the leads assigned to them.{workspace?.messagesEnabled ? "" : " Turn on Messages in owner Settings first."}</span></span><input type="checkbox" disabled={!workspace?.messagesEnabled} checked={employeeMessagingEnabled} onChange={(event) => setEmployeeMessagingEnabled(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label><h3 className="mt-6 text-sm font-black">Assigned Lead Information</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(VISIBILITY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="text-sm font-bold text-slate-700">{label}</span><input type="checkbox" checked={visibility[key] === true} onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" /></label>)}</div><h3 className="mt-6 text-sm font-black">Employee Directory Information</h3><p className="mt-1 text-xs leading-5 text-slate-500">These controls decide what employees can see about coworkers. There is no leaderboard or performance comparison.</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(DIRECTORY_LABELS).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="text-sm font-bold text-slate-700">{label}</span><input type="checkbox" checked={directoryVisibility[key] === true} onChange={(event) => setDirectoryVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" /></label>)}</div><button disabled={Boolean(busy) || !accessDirty} onClick={saveAccess} className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy === "access" ? "Saving…" : "Save Employee Access"}</button></section>}

            {activeSection === "connections" && <div className="mt-4 space-y-3"><section className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6"><p className="text-xs font-semibold leading-5 text-slate-500">Assignments are changed directly from each lead or client in the Leads workspace. This page shows the current connections.</p>{unassignedLeads.length > 0 && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-900">Unassigned · {unassignedLeads.length}</h3><div className="mt-2 flex flex-wrap gap-2">{unassignedLeads.map((lead) => <span key={`${lead.collectionKey}:${lead.id}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-amber-900">{lead.name || "Unnamed lead"}</span>)}</div></div>}<div className="mt-4 grid gap-3 sm:grid-cols-2">{activeEmployees.map((employee) => { const connected = leads.filter((lead) => lead.assignedEmployeeUid === employee.uid); return <article key={employee.uid} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-black">{employee.name}</h3><span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{connected.length} connected</span></div><div className="mt-3 space-y-2">{connected.map((lead) => <div key={`${lead.collectionKey}:${lead.id}`} className="rounded-xl border border-slate-200 bg-white p-3"><p className="truncate text-sm font-black">{lead.name || "Unnamed lead"}</p><p className="mt-1 truncate text-xs font-semibold text-slate-500">{lead.collectionKey === "clients" ? "Client" : "New lead"}{lead.job ? ` · ${lead.job}` : ""}</p></div>)}{connected.length === 0 && <p className="rounded-xl bg-white p-4 text-center text-xs font-semibold text-slate-500">No leads or clients are connected.</p>}</div></article>; })}{activeEmployees.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No active employees are available.</p>}</div></section></div>}
          </div>}
        </section>
      </div>
    </main>
  );
}
