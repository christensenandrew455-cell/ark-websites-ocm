"use client";

import Link from "next/link";
import { useAuth } from "../components/AuthProvider";

export default function MessagesLayout({ children }) {
  const { isAdmin, loading } = useAuth();

  return (
    <>
      {!loading && !isAdmin && (
        <div className="bg-slate-50 px-3 pt-3 sm:px-6 md:px-8">
          <div className="mx-auto max-w-3xl">
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-950 sm:text-sm"
            >
              <span aria-hidden="true">←</span>
              Back to Settings
            </Link>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
