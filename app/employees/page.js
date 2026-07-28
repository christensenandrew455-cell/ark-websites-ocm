"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";

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

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value || "";
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

function SectionButton({ active, value, title, onClick }) {
  return (
    <button type="button" onClick={onClick} className={active ? "min-h-32 w-full rounded-3xl border border-slate-900 bg-slate-900 p-5 text-left text-white shadow-sm transition active:scale-[0.99]" : "min-h-32 w-full rounded-3xl border border-slate-300 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"}>
      <p className="text-3xl font-black">{value}</p>
      <h2 className="mt-2 text-lg font-black">{title}</h2>
    </button>
  );
}

export default function EmployeesPage() {
  const { user, isOwner, profile, loading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [activeSection, setActiveSection] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !isOwner || profile?.employeesEnabled !== true) return;
    try {
      setWorkspace(await employeeApi(user));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [isOwner, profile?.employeesEnabled, user]);

  useEffect(() => {
    if (!loading) load();
  }, [load, loading]);

  async function runAction(payload, message) {
    if (!user || busy) return;
    setBusy(`${payload.action}:${payload.employeeUid || "employee"}`);
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

  function deleteEmployee(employee) {
    if (!window.confirm(`Permanently delete ${employee.name}'s employee account? Their assigned work will become unassigned.`)) return;
    runAction({ action: "delete", employeeUid: employee.uid }, `${employee.name} was deleted.`);
  }

  if (loading || (isOwner && profile?.employeesEnabled && !workspace && !error)) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading employees…</main>;
  }
  if (!isOwner || profile?.employeesEnabled !== true) {
    return <main className="grid min-h-[70vh] place-items-center bg-slate-50 p-6"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">Turn on Employees in Settings.</div></main>;
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
        <Link href="/" aria-label="Back" title="Back" className="grid h-12 w-12 place-items-center rounded-xl border border-slate-300 bg-white text-2xl font-black shadow-sm">←</Link>
        <header className="mt-5">
          <h1 className="text-4xl font-black tracking-tight">Employees</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">Manage your employees.</p>
        </header>
        {notice && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</div>}
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-5">
            <SectionButton active={activeSection === "accounts"} value={employees.length} title="Accounts" onClick={() => setActiveSection((current) => current === "accounts" ? "" : "accounts")} />
            <SectionButton active={activeSection === "connections"} value={assignedLeads.length} title="Connections" onClick={() => setActiveSection((current) => current === "connections" ? "" : "connections")} />
          </div>

          {activeSection && <div className="mt-4 border-t border-slate-300 pt-4 sm:mt-5 sm:pt-5">
            <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black">{activeSection === "accounts" ? "Accounts" : "Connections"}</h2><button type="button" onClick={() => setActiveSection("")} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black">Close</button></div>

            {activeSection === "accounts" && <div className="mt-4 space-y-4">
              <section className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-xl font-black">Employee Requests</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {pendingEmployees.map((employee) => <article key={employee.uid} className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h4 className="font-black">{employee.name}</h4><p className="mt-1 text-xs font-semibold text-slate-600">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-600">{formatPhone(employee.phone)}</p><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={Boolean(busy)} onClick={() => runAction({ action: "approve", employeeUid: employee.uid }, `${employee.name} can now sign in.`)} className="rounded-xl bg-green-700 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50">Approve</button><button disabled={Boolean(busy)} onClick={() => deleteEmployee(employee)} className="rounded-xl border border-red-300 bg-white px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></div></article>)}
                  {pendingEmployees.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No employee requests.</p>}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-xl font-black">Employees</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {managedEmployees.map((employee) => <article key={employee.uid} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate font-black">{employee.name}</h4><p className="mt-1 truncate text-xs font-semibold text-slate-500">{employee.email}</p><p className="mt-1 text-xs font-semibold text-slate-500">{formatPhone(employee.phone)}</p></div>{employee.status !== "active" && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{employee.status}</span>}</div><button disabled={Boolean(busy)} onClick={() => deleteEmployee(employee)} className="mt-4 w-full rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-black text-red-700 disabled:opacity-50">Delete</button></article>)}
                  {managedEmployees.length === 0 && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No employees.</p>}
                </div>
              </section>
            </div>}

            {activeSection === "connections" && <section className="mt-4 rounded-3xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6"><p className="text-xs font-semibold leading-5 text-slate-500">Assignments are changed directly from each lead or client in the Leads workspace. This page shows the current connections.</p>{unassignedLeads.length > 0 && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-900">Unassigned · {unassignedLeads.length}</h3><div className="mt-2 flex flex-wrap gap-2">{unassignedLeads.map((lead) => <span key={`${lead.collectionKey}:${lead.id}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-amber-900">{lead.name || "Unnamed lead"}</span>)}</div></div>}<div className="mt-4 grid gap-3 sm:grid-cols-2">{activeEmployees.map((employee) => { const connected = leads.filter((lead) => lead.assignedEmployeeUid === employee.uid); return <article key={employee.uid} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-black">{employee.name}</h3><span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-black uppercase text-slate-700">{connected.length}</span></div><div className="mt-3 space-y-2">{connected.map((lead) => <div key={`${lead.collectionKey}:${lead.id}`} className="rounded-xl border border-slate-200 bg-white p-3"><p className="truncate text-sm font-black">{lead.name || "Unnamed lead"}</p><p className="mt-1 truncate text-xs font-semibold text-slate-500">{lead.collectionKey === "clients" ? "Client" : "New lead"}{lead.job ? ` · ${lead.job}` : ""}</p></div>)}{connected.length === 0 && <p className="rounded-xl bg-white p-4 text-center text-xs font-semibold text-slate-500">No connections.</p>}</div></article>; })}{activeEmployees.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No active employees.</p>}</div></section>}
          </div>}
        </section>
      </div>
    </main>
  );
}
