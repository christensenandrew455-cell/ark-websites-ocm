"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BackButton from "../../components/BackButton";
import { useAuth } from "../../components/AuthProvider";

const THEME_KEY = "ark-theme-v1";
const SECTIONS = [
  { key: "appearance", title: "Appearance", description: "Dark Mode and display preferences" },
  { key: "business", title: "Business Information", description: "Company and owner contact details" },
  { key: "team", title: "Employees", description: "Coworkers and shared contact details" },
  { key: "policies", title: "Policies", description: "Terms of Use and Privacy Policy" },
];

function EmployeeCard({ employee }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-black">{employee.name || "Employee"}</h3>{employee.isCurrent && <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-black uppercase text-white">You</span>}</div>
      {employee.email && <p className="mt-2 break-all text-xs font-semibold text-slate-500">{employee.email}</p>}
      {employee.phone && <p className="mt-1 text-xs font-semibold text-slate-500">{employee.phone}</p>}
      {!employee.email && !employee.phone && <p className="mt-2 text-xs font-semibold text-slate-400">No contact information is shared.</p>}
    </article>
  );
}

function InformationCard({ label, value, href }) {
  const content = <><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words font-black text-slate-900">{value || "Not provided"}</p></>;
  return href && value ? <a href={href} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white">{content}</a> : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">{content}</div>;
}

export default function EmployeeSettingsPage() {
  const { user, profile } = useAuth();
  const [data, setData] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [activeSection, setActiveSection] = useState("");
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

  const inactiveCard = "min-h-28 rounded-3xl border border-slate-300 bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99] sm:p-5";
  const activeCard = "min-h-28 rounded-3xl border border-slate-900 bg-slate-900 p-4 text-left text-white shadow-sm transition active:scale-[0.99] sm:p-5";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-950 sm:p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <BackButton href="/" />
        <header className="mt-6"><h1 className="text-4xl font-black tracking-tight">Settings</h1></header>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

        <section className="mt-5 rounded-[2rem] border border-slate-300 bg-slate-200/80 p-3 shadow-inner sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {SECTIONS.map((section) => <button key={section.key} type="button" onClick={() => setActiveSection(activeSection === section.key ? "" : section.key)} className={activeSection === section.key ? activeCard : inactiveCard}><h2 className="text-base font-black sm:text-lg">{section.title}</h2><p className="mt-2 text-xs font-semibold opacity-60">{section.description}</p></button>)}
          </div>

          {activeSection && <div className="mt-4 border-t border-slate-300 pt-4 sm:mt-5 sm:pt-5">
            <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black sm:text-2xl">{SECTIONS.find((section) => section.key === activeSection)?.title}</h2><button type="button" onClick={() => setActiveSection("")} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-black">Close</button></div>

              {activeSection === "appearance" && <label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><span><strong className="block text-sm">Dark Mode</strong><span className="text-xs text-slate-500">Use darker backgrounds and lighter text throughout the app.</span></span><input type="checkbox" checked={darkMode} onChange={(event) => updateTheme(event.target.checked)} className="h-5 w-5 accent-slate-950" /></label>}

              {activeSection === "business" && (loading ? <p className="mt-4 text-sm font-semibold text-slate-500">Loading business information…</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InformationCard label="Business" value={data?.businessName || profile?.businessName || "Business"} />
                <InformationCard label="Company owner / Boss" value={data?.ownerName} />
                <InformationCard label="Business email" value={data?.businessEmail} href={data?.businessEmail ? `mailto:${data.businessEmail}` : ""} />
                <InformationCard label="Business phone" value={data?.businessPhone} href={data?.businessPhone ? `tel:${data.businessPhone}` : ""} />
                <InformationCard label="Owner email" value={data?.ownerEmail} href={data?.ownerEmail ? `mailto:${data.ownerEmail}` : ""} />
                <InformationCard label="Owner phone" value={data?.ownerPhone} href={data?.ownerPhone ? `tel:${data.ownerPhone}` : ""} />
              </div>)}

              {activeSection === "team" && <><p className="mt-2 text-xs font-semibold leading-5 text-slate-500">The business owner decides whether coworker names, email addresses, and phone numbers are visible.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{loading && <p className="text-sm font-semibold text-slate-500 sm:col-span-2">Loading employees…</p>}{!loading && (data?.employees || []).map((employee) => <EmployeeCard key={employee.uid} employee={employee} />)}{!loading && (data?.employees || []).length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500 sm:col-span-2">No other active employees are listed.</p>}</div></>}

              {activeSection === "policies" && <div className="mt-4 grid grid-cols-2 gap-2"><Link href="/terms" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/privacy" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link></div>}
            </section>
          </div>}
        </section>
      </div>
    </main>
  );
}
