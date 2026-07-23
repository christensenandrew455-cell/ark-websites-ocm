"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { readApiJson } from "../../lib/apiResponse";

const PHONE_SETUP_PENDING_KEY = "ark-phone-setup-pending-v1";

export default function SignupCompletePage() {
  const router = useRouter();
  const { user, loading, refreshProfile } = useAuth();
  const started = useRef(false);
  const [status, setStatus] = useState("Confirming your payment method…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || started.current) return;
    if (!user) {
      setError("Sign in with the approved account, then reopen payment setup.");
      return;
    }

    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setError("Stripe did not return a payment-setup session.");
      return;
    }

    started.current = true;
    (async () => {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/signup/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId }),
        });
        await readApiJson(response, "Unable to finish account setup.");

        setStatus("Payment method saved. Opening business setup…");
        window.localStorage.setItem(PHONE_SETUP_PENDING_KEY, "true");
        await user.getIdToken(true);
        await refreshProfile();
        router.replace("/setup/business");
      } catch (completeError) {
        setError(completeError.message);
      }
    })();
  }, [loading, refreshProfile, router, user]);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        {!error ? (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" />
            <h1 className="mt-6 text-2xl font-bold">{status}</h1>
            <p className="mt-2 text-sm text-slate-600">Do not close this page yet.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Account setup needs attention</h1>
            <p className="mt-3 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>
            <Link href="/signup/status" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
              Return to account status
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
