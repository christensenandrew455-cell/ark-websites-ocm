"use client";

import { signInWithCustomToken } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import ReceptionistBusinessForm, { prepareReceptionistProfile, receptionistRequestPayload } from "../../components/ReceptionistBusinessForm";
import { readApiJson } from "../../lib/apiResponse";
import { auth } from "../../lib/firebase";
import { validateReceptionistBusinessInformation } from "../../lib/ownerSignup";
import { publicFormError } from "../../lib/userFacingError";

export default function BusinessSetupPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [receptionist, setReceptionist] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/signup");
      return;
    }
    if (profile?.status === "pending_verification" || (profile?.status === "pending_business_setup" && profile?.identityVerificationVerified !== true)) {
      router.replace("/signup/verify");
      return;
    }
    if (profile?.status === "active") {
      router.replace(profile?.identityVerificationRequired && !profile?.identityVerificationVerified ? "/signup/verify" : "/");
      return;
    }

    let active = true;
    (async () => {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/signup/draft", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await readApiJson(response, "Unable to load business information.");
        if (!active) return;
        setReceptionist(prepareReceptionistProfile(data.profile, { requireExplicitSelections: data.profile?.configured !== true }));
      } catch (loadError) {
        if (active) setError(publicFormError(loadError, "Unable to load business information."));
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, [loading, profile?.identityVerificationRequired, profile?.identityVerificationVerified, profile?.status, router, user]);

  async function continueSignup(event) {
    event.preventDefault();
    const validationError = validateReceptionistBusinessInformation(receptionist);
    if (validationError) return setError(validationError);
    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/signup/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(receptionistRequestPayload(receptionist)),
      });
      const data = await readApiJson(response, "Unable to save business information.");
      const destination = data.nextPath === "/signup/payment" ? data.nextPath : "";
      if (!destination || !data.continuationToken) throw new Error("Unable to open payment setup.");
      try {
        await signInWithCustomToken(auth, data.continuationToken);
      } catch {
        await user.getIdToken(true);
      }
      window.location.replace(destination);
    } catch (saveError) {
      setError(publicFormError(saveError, "Unable to save business information."));
      setSaving(false);
    }
  }

  if (loading || !ready) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-sm font-semibold text-white">Opening business information…</main>;
  }

  if (!receptionist) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-slate-950"><section className="w-full max-w-lg rounded-3xl bg-white p-7 text-center shadow-2xl"><p className="text-sm font-bold text-red-700">{error || "Unable to load business information."}</p><Link href="/signup/verify" className="mt-5 inline-block rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700">Back</Link></section></main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] pt-10 text-slate-950">
      <section className="mx-auto w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 3 of 4 · Business information</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Set up your business</h1>

        <form onSubmit={continueSignup} className="mt-7">
          <ReceptionistBusinessForm profile={receptionist} onChange={(next) => { setReceptionist(next); setError(""); }} onboardingMode />
          {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Link href="/signup/verify" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-black text-slate-700">Back</Link>
            <button type="submit" disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{saving ? "Saving…" : "Next"}</button>
          </div>
        </form>
      </section>
    </main>
  );
}
