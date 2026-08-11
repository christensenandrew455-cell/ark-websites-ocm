"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { readApiJson } from "../../lib/apiResponse";
import { validateOwnerSignup } from "../../lib/ownerSignup";
import { clearOwnerSignupDraft, loadOwnerSignupDraft, saveOwnerSignupDraft } from "../../lib/ownerSignupStorage";

const BILLING_SUMMARY = "$50 per month, plus $2 for each new lead, $1 when each chat is created, $1 whenever the rolling SMS counter completes another 50 parts, and $5 for each approved employee active during the billing period.";

export default function SignupStatusPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [mode, setMode] = useState("checking");
  const [draft, setDraft] = useState(null);
  const [application, setApplication] = useState(null);
  const [checking, setChecking] = useState(true);
  const [billing, setBilling] = useState(false);
  const [error, setError] = useState("");
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") setCanceled(true);
  }, []);

  useEffect(() => {
    if (loading) return;
    const stored = loadOwnerSignupDraft();
    if (stored) {
      setDraft(stored);
      setApplication(stored);
      setMode("draft");
      setChecking(false);
      const validationError = validateOwnerSignup(stored);
      if (validationError) setError(validationError);
      return;
    }
    if (user) {
      setMode("legacy");
      return;
    }
    setMode("missing");
    setChecking(false);
  }, [loading, user]);

  useEffect(() => {
    if (mode !== "legacy" || !user) return undefined;
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
  }, [mode, router, user]);

  async function openBilling() {
    if (billing || (mode === "legacy" && !user) || (mode === "draft" && !draft)) return;
    setBilling(true);
    setError("");
    try {
      const headers = { "Content-Type": "application/json" };
      let body = "{}";
      if (mode === "draft") {
        body = JSON.stringify({ signup: saveOwnerSignupDraft(draft) });
      } else {
        const token = await user.getIdToken(true);
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch("/api/billing/create-checkout-session", { method: "POST", headers, body });
      const data = await readApiJson(response, "Unable to open secure payment setup.");
      window.location.assign(data.url);
    } catch (billingError) {
      setError(billingError.message);
      setBilling(false);
    }
  }

  function discardSignup() {
    clearOwnerSignupDraft();
    router.replace("/signup");
  }

  if (loading || checking || mode === "checking") return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-sm font-semibold text-white">Opening payment method…</main>;
  if (mode === "missing") return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl"><h1 className="text-2xl font-black">Signup was discarded</h1><p className="mt-3 text-sm leading-6 text-slate-600">There is no unfinished signup in this app session, and no account was created.</p><Link href="/signup" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Start Signup</Link></section></main>;

  const ready = mode === "draft" ? Boolean(draft) && !validateOwnerSignup(draft) : application?.status === "approved_pending_payment";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] pt-10">
      <section className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 4 of 4 · Payment Method</p>
        <div className={mode === "draft" ? "mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase text-amber-800" : "mt-3 inline-flex rounded-full bg-green-100 px-3 py-1 text-[10px] font-black uppercase text-green-800"}>{mode === "draft" ? "Account not created yet" : "Existing signup"}</div>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Payment Method</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Add a payment method for the ARK AI Receptionist plan. For a new signup, ARK creates the owner account only after Stripe confirms the payment method.</p>
        {application && <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"><p className="font-black text-slate-950">{application.businessName}</p><p className="mt-1 text-slate-600">{application.ownerName}</p><p className="mt-2 break-all text-slate-600">{application.accountEmail}</p><p className="mt-1 text-slate-600">{application.accountPhone}</p></div>}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"><p><strong>What this payment method covers</strong></p><p className="mt-1">{BILLING_SUMMARY}</p><p className="mt-1">Qualified referrals save 10% each for one billing period, up to 50%. Stripe securely stores the payment method and processes recurring and usage-based invoices.</p></div>
        {canceled && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{mode === "draft" ? "Payment setup was canceled. No new account was created." : "Payment setup was canceled. Your existing signup is still ready to continue."}</p>}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        {ready && <button type="button" disabled={billing} onClick={openBilling} className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{billing ? "Opening secure payment…" : "Add Payment Method"}</button>}
        {!ready && !error && <p className="mt-6 text-center text-xs font-semibold leading-5 text-slate-500">This signup is not ready for payment. Return to the previous step and finish the required information.</p>}
        {mode === "draft" ? <div className="mt-4 grid grid-cols-2 gap-3"><Link href="/about?setup=1" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black text-slate-700">Back</Link><button type="button" onClick={discardSignup} className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-black text-red-700">Discard Signup</button></div> : <button type="button" onClick={logout} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700">Sign out</button>}
      </section>
    </main>
  );
}
