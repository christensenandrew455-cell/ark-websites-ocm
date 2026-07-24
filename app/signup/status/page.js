"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { readApiJson } from "../../lib/apiResponse";

const BILLING_SUMMARY = "$50 per month, plus $2 for each AI receptionist call or lead, $1 for each new message conversation when Messages is enabled, and $5 for each active employee when Employees is enabled.";

export default function SignupStatusPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [application, setApplication] = useState(null);
  const [checking, setChecking] = useState(true);
  const [billing, setBilling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") setNotice("Payment setup was canceled. Your account is still saved and ready to continue.");
  }, []);

  useEffect(() => {
    if (loading) return undefined;
    if (!user) { setChecking(false); return undefined; }
    let active = true;
    const checkStatus = async () => {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/signup/status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await readApiJson(response, "Unable to check the account status.");
        if (!active) return;
        setApplication(data);
        setError("");
        if (data.status === "active") router.replace("/");
      } catch (statusError) {
        if (active) setError(statusError.message);
      } finally {
        if (active) setChecking(false);
      }
    };
    checkStatus();
    const timer = window.setInterval(checkStatus, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loading, router, user]);

  async function openBilling() {
    if (!user || billing) return;
    setBilling(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/create-checkout-session", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
      const data = await readApiJson(response, "Unable to open secure payment setup.");
      window.location.assign(data.url);
    } catch (billingError) {
      setError(billingError.message);
      setBilling(false);
    }
  }

  if (loading || checking) return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-sm font-semibold text-white">Checking account status…</main>;
  if (!user) return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl"><h1 className="text-2xl font-black">Sign in to continue</h1><p className="mt-3 text-sm leading-6 text-slate-600">Use the owner credentials entered during signup.</p><Link href="/login?next=/signup/status" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Go to login</Link></section></main>;

  const ready = application?.status === "approved_pending_payment";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5 py-10">
      <section className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <div className="mt-5 inline-flex rounded-full bg-green-100 px-3 py-1 text-[10px] font-black uppercase text-green-800">Account created</div>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Add your payment method</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">There is no administrator approval step. Securely add a payment method to activate the account and finish receptionist setup.</p>
        {application && <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"><p className="font-black text-slate-950">{application.businessName}</p><p className="mt-1 text-slate-600">{application.ownerName}</p><p className="mt-2 break-all text-slate-600">{application.accountEmail}</p><p className="mt-1 text-slate-600">{application.accountPhone}</p></div>}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"><p><strong>ARK AI Receptionist</strong></p><p className="mt-1">{BILLING_SUMMARY}</p><p className="mt-1">Stripe securely stores the payment method and processes recurring and usage-based invoices.</p></div>
        {notice && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{notice}</p>}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        {ready && <button type="button" disabled={billing} onClick={openBilling} className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{billing ? "Opening Stripe…" : "Continue to Secure Payment"}</button>}
        {!ready && <p className="mt-6 text-center text-xs font-semibold leading-5 text-slate-500">This account is not currently ready for payment setup. Refresh or contact support.</p>}
        <button type="button" onClick={logout} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700">Sign out</button>
      </section>
    </main>
  );
}
