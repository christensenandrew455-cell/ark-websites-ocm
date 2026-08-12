"use client";

import { signInWithCustomToken } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { auth } from "../../lib/firebase";
import { readApiJson } from "../../lib/apiResponse";
import { clearOwnerSignupDraft, loadOwnerSignupDraft } from "../../lib/ownerSignupStorage";
import { publicFormError } from "../../lib/userFacingError";

export default function SignupCompletePage() {
  const router = useRouter();
  const { user, loading, refreshProfile } = useAuth();
  const started = useRef(false);
  const [status, setStatus] = useState("Confirming your payment method…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || started.current) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id") || "";
    const handoff = params.get("handoff") || "";
    if (!sessionId) { setError("Something went wrong. Reload and try again."); return; }
    const draft = loadOwnerSignupDraft();
    if (!handoff && !draft && !user) { setError("Your secure signup return link is incomplete. Start signup again."); return; }

    started.current = true;
    (async () => {
      try {
        if (handoff || draft) {
          const response = await fetch("/api/signup/finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, handoff, ...(draft ? { signup: draft } : {}) }),
          });
          const data = await readApiJson(response, "Unable to finish account setup.");
          setStatus("Payment confirmed. Opening your account…");
          if (data.token) {
            const credential = await signInWithCustomToken(auth, data.token);
            await credential.user.getIdToken(true);
          }
        } else {
          const token = await user.getIdToken(true);
          const response = await fetch("/api/signup/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId }) });
          await readApiJson(response, "Unable to finish account setup.");
          setStatus("Payment confirmed. Opening your account…");
          await user.getIdToken(true);
        }
        clearOwnerSignupDraft();
        await refreshProfile();
        router.replace("/");
      } catch (completeError) {
        setError(publicFormError(completeError, "Unable to finish account setup right now."));
      }
    })();
  }, [loading, refreshProfile, router, user]);

  return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">{!error ? <><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" /><h1 className="mt-6 text-2xl font-bold">{status}</h1><p className="mt-2 text-sm text-slate-600">Do not close this page yet.</p></> : <><h1 className="text-2xl font-bold">Account setup needs attention</h1><p className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p><button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">Try Again</button><Link href="/signup" className="mt-3 block text-sm font-bold text-slate-600 underline">Start Signup Again</Link></>}</div></main>;
}
