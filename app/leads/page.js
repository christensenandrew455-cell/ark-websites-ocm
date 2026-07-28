"use client";

import Link from "next/link";
import { useAuth } from "../components/AuthProvider";
import ReviewClientsNative from "../components/ReviewClientsNative";

export default function LeadsPage() {
  const { profile } = useAuth();
  return (
    <div className="leads-layered min-h-screen bg-slate-200 text-slate-950">
      <style>{`
        .leads-layered > main { min-height: auto !important; background: transparent !important; padding-top: 1rem !important; }
        .leads-layered > main > div > section:first-of-type { border: 1px solid #cbd5e1; border-radius: 2rem; background: rgba(203, 213, 225, .72); padding: .75rem; box-shadow: inset 0 1px 2px rgba(15, 23, 42, .08); }
        .leads-layered > main > div > section:first-of-type > button:not(.bg-slate-950) { background-color: #f8fafc !important; border-color: #cbd5e1 !important; }
        .leads-layered > main > div > section:nth-of-type(2) { background-color: #f1f5f9 !important; border-color: #cbd5e1 !important; }
        .leads-layered > main article { background-color: #f8fafc; border-color: #cbd5e1 !important; }
        .leads-layered > main button.bg-white { background-color: #f8fafc !important; }
        @media (min-width: 640px) { .leads-layered > main > div > section:first-of-type { padding: 1.25rem; } }
      `}</style>
      <div className="mx-auto max-w-6xl px-3 pt-5 sm:px-5 sm:pt-8 md:px-8">
        <Link href="/" className="inline-flex rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-black shadow-sm">← Back to Dashboard</Link>
        <header className="mt-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">{profile?.businessName || "Your Business"}</p>
          <h1 className="mt-1 text-4xl font-black tracking-tight">Leads</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">Review new receptionist leads and accepted clients.</p>
        </header>
      </div>
      <ReviewClientsNative />
    </div>
  );
}
