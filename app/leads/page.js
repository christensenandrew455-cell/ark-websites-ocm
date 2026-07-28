"use client";

import Link from "next/link";
import ReviewClientsNative from "../components/ReviewClientsNative";

export default function LeadsPage() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto max-w-6xl px-3 pt-5 sm:px-5 sm:pt-8 md:px-8">
        <Link href="/" aria-label="Back" title="Back" className="grid h-12 w-12 place-items-center rounded-xl border border-slate-300 bg-white text-2xl font-black shadow-sm">←</Link>
        <header className="mt-5">
          <h1 className="text-4xl font-black tracking-tight">Leads</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">Accept new leads and view your clients.</p>
        </header>
      </div>
      <ReviewClientsNative />
    </div>
  );
}
