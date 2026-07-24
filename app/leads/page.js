"use client";

import Link from "next/link";
import { useAuth } from "../components/AuthProvider";
import ReviewClientsNative from "../components/ReviewClientsNative";

export default function LeadsPage() {
  const { profile } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-6xl px-3 pt-5 sm:px-5 sm:pt-8 md:px-8">
        <Link href="/" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black shadow-sm">← Back to Dashboard</Link>
        <header className="mt-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{profile?.businessName || "Your Business"}</p>
          <h1 className="mt-1 text-4xl font-black tracking-tight">Leads</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">Review new receptionist leads and accepted clients.</p>
        </header>
      </div>
      <ReviewClientsNative />
    </div>
  );
}
