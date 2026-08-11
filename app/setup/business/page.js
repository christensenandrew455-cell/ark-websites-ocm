"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile } from "../../components/ReceptionistBusinessForm";
import SettingsPanel from "../../components/SettingsPanel";
import { validateOwnerSignup } from "../../lib/ownerSignup";
import { loadOwnerSignupDraft, saveOwnerSignupDraft } from "../../lib/ownerSignupStorage";

export default function BusinessSetupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [draft, setDraft] = useState(null);
  const [receptionist, setReceptionist] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || user) return;
    const stored = loadOwnerSignupDraft();
    if (!stored) {
      router.replace("/signup");
      return;
    }
    setDraft(stored);
    setReceptionist(prepareReceptionistProfile(stored.receptionist));
    setReady(true);
  }, [loading, router, user]);

  function continueSignup(event) {
    event.preventDefault();
    const next = { ...draft, receptionist };
    const validationError = validateOwnerSignup(next);
    if (validationError) {
      setError(validationError);
      return;
    }
    saveOwnerSignupDraft(next);
    router.push("/about?setup=1");
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-950 text-sm font-semibold text-white">Opening business information…</main>;
  if (user) return <SettingsPanel setupMode />;
  if (!ready || !draft || !receptionist) return <main className="grid min-h-screen place-items-center bg-slate-950 text-sm font-semibold text-white">Opening business information…</main>;

  return (
    <main className="min-h-screen bg-slate-950 p-5 py-10 text-slate-950">
      <section className="mx-auto w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 2 of 4 · Business information</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Set up your business</h1>
        <p className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-semibold leading-6 text-indigo-950">Your business name, owner name, email, and phone are filled from step 1. Complete the remaining receptionist information before payment.</p>

        <form onSubmit={continueSignup} className="mt-7">
          <ReceptionistBusinessForm profile={receptionist} onChange={(next) => { setReceptionist(next); setError(""); }} identityReadOnly />
          {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Link href="/signup" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-black text-slate-700">Back</Link>
            <button type="submit" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Next</button>
          </div>
        </form>
      </section>
    </main>
  );
}
