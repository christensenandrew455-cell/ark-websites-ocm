"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";

const VISIBILITY_LABELS = {
  name: "Lead name",
  phone: "Phone number",
  email: "Email address",
  address: "Job address",
  job: "Requested work",
  requestedTime: "Requested date and time",
  notes: "Additional notes",
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

export default function EmployeesPage() {
  const { user, isBusinessOwner, loading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [visibility, setVisibility] = useState({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !isBusinessOwner) return;
    try {
      const data = await employeeApi(user);
      setWorkspace(data);
      setVisibility(data.employeeVisibility || {});
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [isBusinessOwner, user]);

  useEffect(() => { if (!loading) load(); }, [load, loading]);

  async function runAction(payload, message) {
    if (!user || busy) return;
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
  }

  if (loading || (isBusinessOwner && !workspace && !error)) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading employees…</main>;
  }
  if (!isBusinessOwner) {
    return <main className="grid min-h-[70vh] place-items-center p-6"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">Employees are available only on the Business owner account.</div></main>;
  }

  const employees = workspace?.employees || [];
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const leads = workspace?.leads || [];

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black">← Dashboard</Link>
        <header className="mt-4 sm:mt-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Business workspace</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Employees</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Approve employee accounts, control what employees can see, and route leads or clients to one employee at a time.</p>
        </header>

        {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Seats</p><h2 className="mt-1 text-xl font-black sm:text-2xl">Employee Accounts</h2><p className="mt-1 text-xs font-semibold text-slate-500">{workspace?.activeEmployeeCount || 0} active · {workspace?.includedEmployees || 3} included · $25 monthly for each additional active employee</p></div>
            <Link href="/signup" className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Employee Signup</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {employees.map((employee) => (
              <article key={employee.uid} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-black">{employee.name}</h3><p className="mt-1 truncate text-xs font-semibold text-slate-500">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-500">{employee.phone}</p></div><span className={employee.status === "active" ? "rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-black uppercase text-green-800" : employee.status === "disabled" ? "rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-700" : "rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800"}>{employee.status === "pending_owner_approval" ? "Pending" : employee.status}</span></div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {employee.status !== "active" && <button disabled={Boolean(busy)} onClick={() => runAction({ action: "approve", employeeUid: employee.uid }, `${employee.name} can now sign in and view assigned work.`)} className="rounded-xl bg-green-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Approve</button>}
                  {employee.status === "active" && <button disabled={Boolean(busy)} onClick={() => runAction({ action: "disable", employeeUid: employee.uid }, `${employee.name} was disabled.`)} className="rounded-xl border border-red-300 px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Disable</button>}
                  {employee.status === "disabled" && <button disabled={Boolean(busy)} onClick={() => runAction({ action: "activate", employeeUid: employee.uid }, `${employee.name} was reactivated.`)} className="rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Reactivate</button>}
                </div>
              </article>
            ))}
            {employees.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No employees have requested access yet.</p>}
          </div>
        </section>

        <section id="visibility" className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Employee access</p>
          <h2 className="mt-1 text-xl font-black sm:text-2xl">What Employees Can See</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">These controls apply to every employee. Employees still see only records assigned to them.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(VISIBILITY_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3">
                <span className="text-sm font-bold text-slate-700">{label}</span>
                <input type="checkbox" checked={visibility[key] === true} onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-slate-950" />
              </label>
            ))}
          </div>
          <button disabled={Boolean(busy)} onClick={() => runAction({ action: "visibility", visibility }, "Employee visibility settings were saved.")} className="mt-4 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">Save Employee Access</button>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Lead routing</p>
          <h2 className="mt-1 text-xl font-black sm:text-2xl">Assign Work</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Assign each new lead or accepted client to an active employee. Choosing Unassigned removes the current assignment.</p>
          <div className="mt-4 space-y-2">
            {leads.map((lead) => (
              <article key={`${lead.collectionKey}:${lead.id}`} className="grid gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-[1fr_240px] sm:items-center">
                <div className="min-w-0"><h3 className="truncate text-sm font-black">{lead.name || "Unnamed lead"}</h3><p className="mt-1 truncate text-xs font-semibold text-slate-500">{lead.job || "Work not entered"}{lead.address ? ` · ${lead.address}` : ""}</p><p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{lead.collectionKey === "clients" ? "Client" : "New lead"}</p></div>
                <select value={lead.assignedEmployeeUid || ""} disabled={Boolean(busy)} onChange={(event) => runAction({ action: "assign", collectionKey: lead.collectionKey, recordId: lead.id, employeeUid: event.target.value }, event.target.value ? "Work assignment updated." : "Work was unassigned.")} className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold outline-none focus:border-slate-950">
                  <option value="">Unassigned</option>
                  {activeEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name}</option>)}
                </select>
              </article>
            ))}
            {leads.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">No leads or clients are available to assign.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
