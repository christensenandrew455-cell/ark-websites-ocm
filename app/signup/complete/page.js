"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "../../lib/firebase";
import { readApiJson } from "../../lib/apiResponse";

const PENDING_SIGNUP_KEY = "ark-ocm-pending-signup";
const PHONE_SETUP_PENDING_KEY = "ark-phone-setup-pending-v1";

export default function SignupCompletePage() {
  const router = useRouter();
  const [status, setStatus] = useState("Confirming your payment method…");
  const [error, setError] = useState("");

  useEffect(() => {
    async function completeSignup() {
      const sessionId = new URLSearchParams(window.location.search).get("session_id");
      let pending = null;
      try {
        const pendingRaw = sessionStorage.getItem(PENDING_SIGNUP_KEY);
        pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      } catch {
        pending = null;
      }

      if (!sessionId) {
        setError("Stripe did not return a payment-setup session.");
        return;
      }

      if (!pending?.password) {
        setError("The secure signup window expired. Contact ARK Websites if the card setup was completed.");
        return;
      }

      try {
        const response = await fetch("/api/signup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, password: pending.password }),
        });
        const data = await readApiJson(response, "Unable to finish account setup.");

        setStatus("Account activated. Signing you in…");
        await signInWithEmailAndPassword(auth, data.email, pending.password);
        sessionStorage.removeItem(PENDING_SIGNUP_KEY);
        window.localStorage.setItem(PHONE_SETUP_PENDING_KEY, "true");
        router.replace(`/?clientId=${encodeURIComponent(data.clientId)}`);
      } catch (completeError) {
        setError(completeError.message);
      }
    }

    completeSignup();
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        {!error ? (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" />
            <h1 className="mt-6 text-2xl font-bold">{status}</h1>
            <p className="mt-2 text-sm text-slate-600">Do not close this tab yet.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Account setup needs attention</h1>
            <p className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>
            <Link href="/login" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
              Go to login
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
