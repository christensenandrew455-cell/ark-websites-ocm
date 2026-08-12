"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { readApiJson } from "../../lib/apiResponse";
import { validateOwnerSignup } from "../../lib/ownerSignup";
import { clearOwnerSignupDraft, loadOwnerSignupDraft, saveOwnerSignupDraft } from "../../lib/ownerSignupStorage";
import { publicFormError } from "../../lib/userFacingError";

const PHONE_SETUP_PENDING_KEY = "ark-phone-setup-pending-v1";
export default function SignupStatusPage() {
  const router = useRouter();
  const { user, loading, logout, refreshProfile } = useAuth();
  const [mode, setMode] = useState("checking");
  const [draft, setDraft] = useState(null);
  const [application, setApplication] = useState(null);
  const [checking, setChecking] = useState(true);
  const [billing, setBilling] = useState(false);
  const [error, setError] = useState("");

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
        if (data.status === "active") {
          await user.getIdToken(true);
          await refreshProfile();
          window.localStorage.setItem(PHONE_SETUP_PENDING_KEY, "true");
          router.replace("/");
        }
      } catch (statusError) {
        if (active) setError(publicFormError(statusError, "Unable to check the account status."));
      } finally {
        if (active) setChecking(false);
      }
    };
    checkStatus();
    const timer = window.setInterval(checkStatus, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [mode, refreshProfile, router, user]);

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
      setError(publicFormError(billingError, "Unable to open secure payment setup."));
      setBilling(false);
    }
  }

  function discardSignup() {
    clearOwnerSignupDraft();
    router.replace("/signup");
  }

  if (loading || checking || mode === "checking") return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-sm font-semibold text-white">Opening payment method…</main>;
  if (mode === "missing") return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl"><h1 className="text-2xl font-black">Return to signup</h1><p className="mt-3 text-sm leading-6 text-slate-600">Open signup in the app to continue adding your payment method.</p><Link href="/signup" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Open Signup</Link></section></main>;

  const pendingApproval = mode === "legacy" && application?.status === "pending_admin_approval";
  const ready = mode === "draft" ? Boolean(draft) && !validateOwnerSignup(draft) : application?.status === "approved_pending_payment";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] pt-10">
      <section className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">{pendingApproval ? "Account approval" : "Step 4 of 4 · Payment Method"}</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight">{pendingApproval ? "Payment Method Added" : "Add Payment Method"}</h1>
        {pendingApproval && <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">Your account is waiting for approval. You can close this page and sign in later to check the status.</p>}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        {ready && <button type="button" disabled={billing} onClick={openBilling} className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{billing ? "Opening secure payment…" : "Add Payment Method"}</button>}
        {!ready && !pendingApproval && !error && <p className="mt-6 text-center text-xs font-semibold leading-5 text-slate-500">This signup is not ready for payment. Return to the previous step and finish the required information.</p>}
        {mode === "draft" ? <div className="mt-4 grid grid-cols-2 gap-3"><Link href="/about?setup=1" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black text-slate-700">Back</Link><button type="button" onClick={discardSignup} className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-black text-red-700">Discard Signup</button></div> : <button type="button" onClick={logout} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700">Sign out</button>}
      </section>
    </main>
  );
}
