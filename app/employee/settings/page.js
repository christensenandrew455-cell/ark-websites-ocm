"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";

const THEME_KEY = "ark-theme-v1";

function EmployeeCard({ employee }) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-black">{employee.name || "Employee"}</h3>{employee.isCurrent && <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-black uppercase text-white">You</span>}</div>
      {employee.email && <p className="mt-2 break-all text-xs font-semibold text-slate-500">{employee.email}</p>}
      {employee.phone && <p className="mt-1 text-xs font-semibold text-slate-500">{employee.phone}</p>}
      {!employee.email && !employee.phone && <p className="mt-2 text-xs font-semibold text-slate-400">No contact information is shared.</p>}
    </article>
  );
}

export default function EmployeeSettingsPage() {
  const { user, profile } = useAuth();
  const [data, setData] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/employee-dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load employee settings.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load employee settings.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    try { setDarkMode(window.localStorage.getItem(THEME_KEY) === "dark"); } catch { setDarkMode(false); }
    load();
  }, [load]);

  function updateTheme(checked) {
    setDarkMode(checked);
    try { window.localStorage.setItem(THEME_KEY, checked ? "dark" : "light"); } catch {}
    document.documentElement.classList.toggle("ark-dark", checked);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black">← Dashboard</Link>
        <header className="mt-6"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Employee account</p><h1 className="mt-1 text-4xl font-black tracking-tight">Settings</h1></header>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-xl font-black">Appearance</h2>
          <label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span><strong className="block text-sm">Dark Mode</strong><span className="text-xs text-slate-500">Use darker backgrounds and lighter text throughout the app.</span></span><input type="checkbox" checked={darkMode} onChange={(event) => updateTheme(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Company</p>
          <h2 className="mt-1 text-xl font-black">Business Information</h2>
          {loading ? <p className="mt-4 text-sm font-semibold text-slate-500">Loading company information…</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Business</p><p className="mt-1 font-black">{data?.businessName || profile?.businessName || "Business"}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Company owner / Boss</p><p className="mt-1 font-black">{data?.ownerName || "Business owner"}</p></div></div>}
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Team</p>
          <h2 className="mt-1 text-xl font-black">Employees</h2>
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">The business owner decides whether coworker names, email addresses, and phone numbers are visible.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{loading && <p className="text-sm font-semibold text-slate-500 sm:col-span-2">Loading employees…</p>}{!loading && (data?.employees || []).map((employee) => <EmployeeCard key={employee.uid} employee={employee} />)}{!loading && (data?.employees || []).length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No other active employees are listed.</p>}</div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-xl font-black">Policies</h2>
          <div className="mt-4 grid grid-cols-2 gap-2"><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link></div>
        </section>
      </div>
    </main>
  );
}
