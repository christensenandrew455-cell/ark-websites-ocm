"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../components/AuthProvider";

export default function EmployeePendingPage() {
  const router = useRouter();
  const { profile, loading, logout, refreshProfile } = useAuth();

  useEffect(() => {
    if (loading) return undefined;
    if (profile?.status === "active") {
      router.replace("/");
      return undefined;
    }
    const interval = window.setInterval(async () => {
      const next = await refreshProfile().catch(() => null);
      if (next?.status === "active") router.replace("/");
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loading, profile?.status, refreshProfile, router]);

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-sm font-semibold text-white">Checking employee access…</main>;
  }

  const disabled = profile?.status === "disabled";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <section className="w-full max-w-lg rounded-3xl bg-white p-7 text-center shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">{profile?.businessName || "Business account"}</p>
        <div className={disabled ? "mx-auto mt-5 inline-flex rounded-full bg-red-100 px-3 py-1 text-[10px] font-black uppercase text-red-700" : "mx-auto mt-5 inline-flex rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase text-amber-800"}>
          {disabled ? "Access disabled" : "Owner approval required"}
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight">{disabled ? "Employee access is disabled" : "Your employee account is ready"}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {disabled
            ? "The business owner disabled this employee account. Ask the owner to reactivate it from the Employees workspace."
            : "The business owner needs to approve your account before you can see assigned leads or messages. This page checks automatically."}
        </p>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm">
          <p className="font-black text-slate-950">{profile?.employeeName || profile?.email || "Employee"}</p>
          <p className="mt-1 text-slate-600">{profile?.businessName || profile?.clientId}</p>
          <p className="mt-1 break-all text-slate-600">{profile?.accountEmail || profile?.email}</p>
        </div>
        {!disabled && <button type="button" onClick={() => refreshProfile()} className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Check Again</button>}
        <button type="button" onClick={logout} className="mt-3 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700">Sign out</button>
      </section>
    </main>
  );
}
