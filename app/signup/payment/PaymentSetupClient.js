"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readApiJson } from "../../lib/apiResponse";
import { useAuth } from "../../components/AuthProvider";

const FAILURE_MESSAGE = "your payment has failed update your payment method or try again later";

function PaymentForm({ clientSecret, returnUrl, onSucceeded }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const submitted = await elements.submit();
      if (submitted.error) throw submitted.error;
      const result = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (result.error || !result.setupIntent?.id) throw result.error || new Error("SetupIntent was not returned.");
      await onSucceeded(result.setupIntent.id);
    } catch (setupError) {
      console.error("Stripe payment-method setup failed", setupError);
      setError(FAILURE_MESSAGE);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <PaymentElement options={{ layout: "accordion" }} />
      <button id="checkout-and-portal-button" type="submit" disabled={!stripe || !elements || submitting} aria-busy={submitting} className="w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">Pay & Continue</button>
      {error && <p id="error-message" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
    </form>
  );
}

export default function PaymentSetupClient() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(false);
  const completionStarted = useRef(false);

  const completeSetup = useCallback(async (setupIntentId) => {
    if (!user || completionStarted.current) return;
    completionStarted.current = true;
    setChecking(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/setup-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ setupIntentId }),
      });
      const data = await readApiJson(response, FAILURE_MESSAGE);
      if (data.status !== "succeeded") throw new Error(FAILURE_MESSAGE);
      setSuccess(true);
      window.setTimeout(() => window.location.replace(data.nextPath || "/signup/verify"), 900);
      void user.getIdToken(true)
        .then(() => refreshProfile())
        .catch((refreshError) => console.warn("Payment setup completed, but the local account state could not refresh before redirect.", refreshError));
    } catch (setupError) {
      console.error("Unable to verify payment-method setup", setupError);
      setError(FAILURE_MESSAGE);
      setChecking(false);
      completionStarted.current = false;
    }
  }, [refreshProfile, user]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/signup");
      return;
    }
    if (success) return;
    const returnedSetupIntentId = new URLSearchParams(window.location.search).get("setup_intent");
    if (returnedSetupIntentId) {
      completeSetup(returnedSetupIntentId);
      return;
    }
    if (profile?.status === "active" && profile?.identityVerificationRequired && !profile?.identityVerificationVerified) {
      router.replace("/signup/verify");
      return;
    }
    if (profile?.status === "pending_business_setup") {
      router.replace("/setup/business");
      return;
    }
    if (profile?.status === "active") {
      router.replace("/");
      return;
    }

    let active = true;
    (async () => {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/billing/setup-intent", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await readApiJson(response, FAILURE_MESSAGE);
        if (!active) return;
        if (!data.clientSecret || !data.publishableKey || !data.returnUrl) throw new Error(FAILURE_MESSAGE);
        setConfiguration(data);
      } catch (setupError) {
        console.error("Unable to open Stripe Payment Element", setupError);
        if (active) setError(FAILURE_MESSAGE);
      }
    })();
    return () => { active = false; };
  }, [completeSetup, loading, profile?.identityVerificationRequired, profile?.identityVerificationVerified, profile?.status, router, success, user]);

  const stripePromise = useMemo(() => configuration?.publishableKey ? loadStripe(configuration.publishableKey) : null, [configuration?.publishableKey]);
  const elementOptions = useMemo(() => configuration?.clientSecret ? {
    clientSecret: configuration.clientSecret,
    appearance: {
      theme: "stripe",
      variables: { colorPrimary: "#020617", borderRadius: "12px" },
    },
  } : null, [configuration?.clientSecret]);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 py-10 text-slate-950">
      <section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 3 of 4 · Payment</p>
        {success ? <p id="success-message" className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-lg font-black text-emerald-900" role="status">Payment saved. Opening verification…</p> : checking ? <p className="mt-8 text-center text-sm font-bold text-slate-600">Confirming payment method…</p> : configuration && stripePromise && elementOptions ? <div className="mt-7"><Elements stripe={stripePromise} options={elementOptions}><PaymentForm clientSecret={configuration.clientSecret} returnUrl={configuration.returnUrl} onSucceeded={completeSetup} /></Elements></div> : !error ? <p className="mt-8 text-center text-sm font-bold text-slate-600">Opening secure payment fields…</p> : null}
        {error && <p id="error-message" className="mt-7 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
      </section>
    </main>
  );
}
