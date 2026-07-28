"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import BackButton from "./BackButton";
import { useAuth } from "./AuthProvider";

export default function LegalPageHeader({ title, effectiveDate, version, active }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  function goBack() {
    if (window.history.length > 1) { router.back(); return; }
    router.push("/settings");
  }
  return <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
    <div>
      <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">ARK Client Center</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm font-semibold text-slate-500">Effective {effectiveDate} · Version {version}</p>
    </div>
    {!loading && user ? <BackButton onClick={goBack} /> : <div className="flex flex-wrap gap-2">
      <Link href="/signup" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Back</Link>
      <Link href="/privacy" className={active === "privacy" ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white" : "rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"}>Privacy Policy</Link>
      <Link href="/terms" className={active === "terms" ? "rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white" : "rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"}>Terms of Use</Link>
    </div>}
  </div>;
}
