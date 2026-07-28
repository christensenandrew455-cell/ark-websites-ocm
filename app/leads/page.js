"use client";

import BackButton from "../components/BackButton";
import ReviewClientsNative from "../components/ReviewClientsNative";

export default function LeadsPage() {
  return (
    <div className="leads-simple min-h-screen bg-slate-100 text-slate-950">
      <style>{`
        .leads-simple > div:last-child section > div:first-child > button { min-height: 7rem !important; padding: 1.25rem !important; }
        .leads-simple > div:last-child section > div:first-child > button > p:first-child { font-size: 1.875rem !important; line-height: 2.25rem !important; }
        .leads-simple > div:last-child section > div:first-child > button > h2 { margin-top: .5rem !important; font-size: 1.25rem !important; line-height: 1.75rem !important; }
        .leads-simple > div:last-child section > div:first-child > button > p:last-child { display: none; }
      `}</style>
      <div className="mx-auto max-w-6xl px-3 pt-5 sm:px-5 sm:pt-8 md:px-8">
        <BackButton href="/" />
        <header className="mt-5">
          <h1 className="text-4xl font-black tracking-tight">Leads</h1>
        </header>
      </div>
      <ReviewClientsNative />
    </div>
  );
}
