"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { signOut } from "firebase/auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readApiJson } from "../../lib/apiResponse";
import { useAuth } from "../../components/AuthProvider";
import { auth } from "../../lib/firebase";

const FAILURE_MESSAGE = "your payment has failed update your payment method or try again later";

function visibleSetupError(error) {
  const message = String(error?.message || "").trim();
  return message.startsWith("Stripe is connected, but live payments are not enabled") ? message : FAILURE_MESSAGE;
}

function cardWasDeclined(error) {
  const values = [error?.code, error?.decline_code].map((value) => String(value || "").toLowerCase());
  return values.some((value) => value === "card_declined" || Boolean(value && value.includes("declin")));
}

function PaymentForm({ clientSecret, returnUrl, onSucceeded, onDeclined }) {
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
      if (cardWasDeclined(setupError)) {
        try {
          await onDeclined();
        } catch (cleanupError) {
          console.error("Unable to remove declined temporary signup", cleanupError);
          setError(FAILURE_MESSAGE);
          setSubmitting(false);
        }
        return;
      }
      setError(FAILURE_MESSAGE);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <PaymentElement options={{ layout: "accordion" }} />
      <p className="text-sm leading-6 text-slate-600">By adding your card, you agree to a $50 monthly recurring fee, plus additional usage of $2 per accepted lead. Calls, declined leads, and unaccepted leads are not charged.</p>
      <button id="checkout-and-portal-button" type="submit" disabled={!stripe || !elements || submitting} aria-busy={submitting} className="w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">Pay & Continue</button>
      {error && <p id="error-message" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
    </form>
  );
}

export default function PaymentSetupClient() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const completionStarted = useRef(false);

  const leaveCanceledSignup = useCallback(async () => {
    await signOut(auth).catch((signOutError) => console.warn("Unable to clear the canceled temporary sign-in", signOutError));
    window.location.replace("/signup");
  }, []);

  const cancelDeclinedSignup = useCallback(async () => {
    if (!user) throw new Error(FAILURE_MESSAGE);
    const token = await user.getIdToken(true);
    const response = await fetch("/api/signup/draft", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await readApiJson(response, FAILURE_MESSAGE);
    await leaveCanceledSignup();
  }, [leaveCanceledSignup, user]);

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
      setChecking(false);
    } catch (setupError) {
      console.error("Unable to verify payment-method setup", setupError);
      if (setupError?.data?.signupCanceled === true) {
        await leaveCanceledSignup();
        return;
      }
      setError(FAILURE_MESSAGE);
      setChecking(false);
      completionStarted.current = false;
    }
  }, [leaveCanceledSignup, user]);

  async function backToSignIn() {
    if (leaving) return;
    setLeaving(true);
    await signOut(auth).catch((signOutError) => console.warn("Unable to clear the completed signup sign-in", signOutError));
    window.location.replace("/login");
  }

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
    if (profile?.status === "pending_verification") {
      router.replace("/signup/verify");
      return;
    }
    if (profile?.status === "pending_business_setup") {
      router.replace("/setup/business");
      return;
    }
    if (profile?.status === "active") {
      signOut(auth)
        .catch((signOutError) => console.warn("Unable to clear the completed signup sign-in", signOutError))
        .finally(() => window.location.replace("/login"));
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
        if (active) setError(visibleSetupError(setupError));
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

  return <>
    <main className="ark-auth-page grid min-h-screen place-items-center px-5 py-10">
      <section className="ark-auth-card w-full max-w-xl rounded-3xl p-6 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 4 of 4 · Payment</p>
        {success ? <p id="success-message" className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-lg font-black text-emerald-900" role="status">Payment setup complete</p> : checking ? <p className="mt-8 text-center text-sm font-bold text-slate-600">Confirming payment method…</p> : configuration && stripePromise && elementOptions ? <div className="mt-7"><Elements stripe={stripePromise} options={elementOptions}><PaymentForm clientSecret={configuration.clientSecret} returnUrl={configuration.returnUrl} onSucceeded={completeSetup} onDeclined={cancelDeclinedSignup} /></Elements></div> : !error ? <p className="mt-8 text-center text-sm font-bold text-slate-600">Opening secure payment fields…</p> : null}
        {error && <p id="error-message" className="mt-7 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
      </section>
    </main>
    {success && <div className="fixed inset-0 z-[240] grid place-items-center bg-slate-950/75 p-5 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="payment-complete-title" aria-describedby="payment-complete-message">
      <section className="w-full max-w-md rounded-3xl border border-emerald-200 bg-white p-7 text-center text-slate-950 shadow-2xl sm:p-9">
        <div aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-2xl font-black text-emerald-800">✓</div>
        <h1 id="payment-complete-title" className="mt-5 text-2xl font-black tracking-tight">Your account is ready</h1>
        <p id="payment-complete-message" className="mt-3 text-sm font-semibold leading-6 text-slate-600">Your payment information is set up. Now, go sign in to your ARK Client Center.</p>
        <button type="button" onClick={backToSignIn} disabled={leaving} className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white disabled:opacity-60">{leaving ? "Opening sign in…" : "Back to sign in"}</button>
      </section>
    </div>}
  </>;
}
