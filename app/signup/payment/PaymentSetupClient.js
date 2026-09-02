"use client";

import { Capacitor } from "@capacitor/core";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readApiJson } from "../../lib/apiResponse";
import { billingPlan, publicBillingPlans } from "../../lib/billingPricing";
import SubscriptionPlanCard from "../../components/SubscriptionPlanCard";
import {
  activeWebLaunchOffer,
  discountedAmountCents,
  publicPromotion,
} from "../../lib/temporaryFeatures";
import { useAuth } from "../../components/AuthProvider";
import { auth } from "../../lib/firebase";
import {
  appleIapAvailable,
  appleProducts,
  finishAppleTransaction,
  purchaseWithApple,
  restoreApplePurchases,
  unfinishedAppleTransactions,
} from "../../lib/appleIapClient";

const FAILURE_MESSAGE = "your payment has failed update your payment method or try again later";
const MONTHLY_PLANS = publicBillingPlans();

function money(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents || 0) / 100);
}

function PlanSelector({ selectedPlanKey, onSelect, promotion, disabled = false }) {
  return <section aria-labelledby="choose-plan-title">
    <h1 id="choose-plan-title" className="text-2xl font-black tracking-tight text-slate-950">Choose your monthly accepted-lead plan</h1>
    <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Each unique service request counts once when you accept it. Calls do not count, and your allowance resets every billing month.</p>
    {promotion && <div className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950"><p className="text-sm font-black">{promotion.percentOff}% off every plan through the website</p><p className="mt-1 text-xs font-semibold leading-5">Subscribe while this launch offer is available and the discounted price stays on every monthly renewal while your subscription remains active.</p></div>}
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {MONTHLY_PLANS.map((plan) => {
        const selected = plan.key === selectedPlanKey;
        const promotionalAmount = promotion ? discountedAmountCents(plan.amountCents, promotion) : plan.amountCents;
        return <button key={plan.key} type="button" onClick={() => onSelect(plan.key)} disabled={disabled} aria-pressed={selected} className={`rounded-2xl border p-4 text-left transition disabled:opacity-60 ${selected ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200" : "border-slate-200 bg-white hover:border-slate-400"}`}>
          <SubscriptionPlanCard plan={plan} promotionalAmountCents={promotion ? promotionalAmount : 0} />
          {selected && <span className="mt-3 block text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700">Selected</span>}
        </button>;
      })}
    </div>
  </section>;
}

function visibleSetupError(error) {
  const message = String(error?.message || "").trim();
  return message.startsWith("Stripe is connected, but live payments are not enabled") ? message : FAILURE_MESSAGE;
}

function cardWasDeclined(error) {
  const values = [error?.code, error?.decline_code].map((value) => String(value || "").toLowerCase());
  return values.some((value) => value === "card_declined" || Boolean(value && value.includes("declin")));
}

function PaymentForm({ clientSecret, returnUrl, selectedPlan, promotion, onSucceeded, onDeclined }) {
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

  return <form onSubmit={submit} className="space-y-5">
    <PaymentElement options={{ layout: "accordion" }} />
    <p className="text-sm leading-6 text-slate-600">By adding your card, you agree to the {selectedPlan.name} plan at {money(selectedPlan.amountCents)} per month for {selectedPlan.monthlyAcceptedLeads} accepted leads each billing month. Calls do not count.{promotion ? ` This is the ${promotion.percentOff}% website launch price (normally ${money(selectedPlan.listAmountCents)}) and renews at the discounted price while the subscription remains active.` : ""}</p>
    <button id="checkout-and-portal-button" type="submit" disabled={!stripe || !elements || submitting} aria-busy={submitting} className="w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">Pay & Continue</button>
    {error && <p id="error-message" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
  </form>;
}

function ApplePaymentForm({ configuration, user, onSucceeded }) {
  const [storeProduct, setStoreProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const resumedTransactionIds = useRef(new Set());

  const verifyAndFinish = useCallback(async (purchase) => {
    if (!purchase?.signedTransaction || !purchase?.transactionId) throw new Error("Apple did not return a verified transaction.");
    const token = await user.getIdToken(true);
    const response = await fetch("/api/billing/apple/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signedTransaction: purchase.signedTransaction }),
    });
    const data = await readApiJson(response, "Apple could not verify this purchase.");
    await finishAppleTransaction(purchase.transactionId).catch((finishError) => console.warn("Apple will retry transaction completion", finishError));
    await onSucceeded(data);
  }, [onSucceeded, user]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await appleProducts(configuration.productIds);
        const product = (result.products || []).find((item) => item.id === configuration.selectedPlan.productId);
        if (!product) throw new Error(`The ARK ${configuration.selectedPlan.name} plan is not available from Apple yet.`);
        if (active) setStoreProduct(product);
      } catch (loadError) {
        console.error("Unable to load Apple subscription", loadError);
        if (active) setError(String(loadError?.message || "The Apple subscription could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [configuration.productIds, configuration.selectedPlan.name, configuration.selectedPlan.productId]);

  useEffect(() => {
    const resume = async () => {
      try {
        const result = await unfinishedAppleTransactions([configuration.selectedPlan.productId]);
        const purchase = (result.transactions || []).find((item) => item.productId === configuration.selectedPlan.productId);
        if (!purchase || resumedTransactionIds.current.has(purchase.transactionId)) return;
        resumedTransactionIds.current.add(purchase.transactionId);
        try {
          await verifyAndFinish(purchase);
        } catch (error) {
          resumedTransactionIds.current.delete(purchase.transactionId);
          throw error;
        }
      } catch (resumeError) {
        console.warn("Unable to resume unfinished Apple subscription", resumeError);
      }
    };
    resume();
    const interval = window.setInterval(resume, 15 * 1000);
    return () => window.clearInterval(interval);
  }, [configuration.selectedPlan.productId, verifyAndFinish]);

  async function subscribe() {
    if (submitting) return;
    setSubmitting(true); setNotice(""); setError("");
    try {
      const purchase = await purchaseWithApple({
        productId: configuration.selectedPlan.productId,
        appAccountToken: configuration.appAccountToken,
      });
      if (purchase.status === "cancelled") { setNotice("The Apple purchase was canceled. No charge was made."); return; }
      if (purchase.status === "pending") { setNotice("Apple is reviewing this purchase. ARK will finish setup after Apple approves it."); return; }
      await verifyAndFinish(purchase);
    } catch (purchaseError) {
      console.error("Apple subscription purchase failed", purchaseError);
      setError(String(purchaseError?.message || "The Apple purchase could not be completed."));
    } finally {
      setSubmitting(false);
    }
  }

  async function restore() {
    if (restoring) return;
    setRestoring(true); setNotice(""); setError("");
    try {
      const result = await restoreApplePurchases(configuration.productIds);
      const purchase = (result.transactions || []).find((item) => configuration.productIds.includes(item.productId));
      if (!purchase) { setNotice("No active ARK accepted-lead plan was found for this Apple Account."); return; }
      await verifyAndFinish(purchase);
    } catch (restoreError) {
      console.error("Unable to restore Apple subscription", restoreError);
      setError(String(restoreError?.message || "Apple purchases could not be restored."));
    } finally {
      setRestoring(false);
    }
  }

  if (loading) return <p className="text-center text-sm font-bold text-slate-600">Loading Apple subscription…</p>;
  return <div className="space-y-5">
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">ARK {configuration.selectedPlan.name} plan</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{storeProduct?.displayPrice || money(configuration.selectedPlan.amountCents)} <span className="text-sm text-slate-500">per month</span></p>
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Includes ARK Client Center and {configuration.selectedPlan.monthlyAcceptedLeads} accepted leads each billing month. Calls do not count.</p>
    </div>
    <p className="text-xs font-semibold leading-5 text-slate-600">Payment is charged to your Apple Account at confirmation. The subscription automatically renews monthly unless canceled at least 24 hours before the current period ends. Your Apple Account is charged for renewal within 24 hours before the period ends. Manage or cancel in your App Store subscription settings.</p>
    <p className="text-xs font-semibold text-slate-600"><Link href="/terms" className="font-black underline">Terms of Use</Link><span aria-hidden="true"> · </span><Link href="/privacy" className="font-black underline">Privacy Policy</Link></p>
    <button id="apple-subscribe-button" type="button" onClick={subscribe} disabled={!storeProduct || submitting || restoring} className="w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white disabled:opacity-50">{submitting ? "Confirming with Apple…" : `Choose ${configuration.selectedPlan.name} with Apple`}</button>
    <button type="button" onClick={restore} disabled={submitting || restoring} className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 disabled:opacity-50">{restoring ? "Restoring…" : "Restore Purchases"}</button>
    {notice && <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800" role="status">{notice}</p>}
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
  </div>;
}

export default function PaymentSetupClient() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [billingPlatform, setBillingPlatform] = useState("checking");
  const [promotion, setPromotion] = useState(null);
  const [selectedPlanKey, setSelectedPlanKey] = useState("starter");
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const completionStarted = useRef(false);
  const selectedPlan = billingPlan(selectedPlanKey);
  const selectedPaymentPlan = useMemo(() => ({
    ...selectedPlan,
    listAmountCents: selectedPlan.amountCents,
    amountCents: promotion ? discountedAmountCents(selectedPlan.amountCents, promotion) : selectedPlan.amountCents,
  }), [promotion, selectedPlan]);

  function selectPlan(planKey) {
    setConfiguration(null);
    setError("");
    setSelectedPlanKey(planKey);
  }

  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    setPromotion(native ? null : publicPromotion(activeWebLaunchOffer()));
    setBillingPlatform(appleIapAvailable() ? "apple" : "stripe");
  }, []);

  const leaveCanceledSignup = useCallback(async () => {
    await signOut(auth).catch((signOutError) => console.warn("Unable to clear the canceled temporary sign-in", signOutError));
    window.location.replace("/signup");
  }, []);

  const cancelDeclinedSignup = useCallback(async () => {
    if (!user) throw new Error(FAILURE_MESSAGE);
    const token = await user.getIdToken(true);
    const response = await fetch("/api/signup/draft", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await readApiJson(response, FAILURE_MESSAGE);
    await leaveCanceledSignup();
  }, [leaveCanceledSignup, user]);

  const completeSetup = useCallback(async (setupIntentId) => {
    if (!user || completionStarted.current) return;
    completionStarted.current = true; setChecking(true); setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/setup-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ setupIntentId }),
      });
      const data = await readApiJson(response, FAILURE_MESSAGE);
      if (data.status !== "succeeded") throw new Error(FAILURE_MESSAGE);
      setSuccess(true); setChecking(false);
    } catch (setupError) {
      console.error("Unable to verify payment-method setup", setupError);
      if (setupError?.data?.signupCanceled === true) { await leaveCanceledSignup(); return; }
      setError(FAILURE_MESSAGE); setChecking(false); completionStarted.current = false;
    }
  }, [leaveCanceledSignup, user]);

  const completeAppleSetup = useCallback(async (data) => {
    if (data?.status !== "succeeded") throw new Error("Apple could not finish account setup.");
    setSuccess(true); setChecking(false);
  }, []);

  async function backToSignIn() {
    if (leaving) return;
    setLeaving(true);
    await signOut(auth).catch((signOutError) => console.warn("Unable to clear the completed signup sign-in", signOutError));
    window.location.replace("/login");
  }

  useEffect(() => {
    if (loading || billingPlatform === "checking") return;
    if (!user) { router.replace("/signup"); return; }
    if (success) return;
    const returnedSetupIntentId = new URLSearchParams(window.location.search).get("setup_intent");
    if (returnedSetupIntentId) { completeSetup(returnedSetupIntentId); return; }
    if (profile?.status === "active" && profile?.identityVerificationRequired && !profile?.identityVerificationVerified) { router.replace("/signup/verify"); return; }
    if (profile?.status === "pending_verification") { router.replace("/signup/verify"); return; }
    if (profile?.status === "pending_business_setup") { router.replace("/setup/business"); return; }
    if (profile?.status === "active") {
      signOut(auth).catch((signOutError) => console.warn("Unable to clear the completed signup sign-in", signOutError)).finally(() => window.location.replace("/login"));
      return;
    }
    let active = true;
    setConfiguration(null);
    (async () => {
      try {
        const token = await user.getIdToken(true);
        const endpoint = billingPlatform === "apple" ? "/api/billing/apple/configuration" : "/api/billing/setup-intent";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ planKey: selectedPlanKey }),
        });
        const data = await readApiJson(response, FAILURE_MESSAGE);
        if (!active) return;
        if (billingPlatform === "apple") {
          if (!data.appAccountToken || !data.selectedPlan?.productId) throw new Error(FAILURE_MESSAGE);
        } else if (!data.clientSecret || !data.publishableKey || !data.returnUrl) throw new Error(FAILURE_MESSAGE);
        setPromotion(data.promotion || null);
        setConfiguration(data);
      } catch (setupError) {
        console.error(`Unable to open ${billingPlatform === "apple" ? "Apple" : "Stripe"} payment setup`, setupError);
        if (active) setError(billingPlatform === "apple" ? String(setupError?.message || FAILURE_MESSAGE) : visibleSetupError(setupError));
      }
    })();
    return () => { active = false; };
  }, [billingPlatform, completeSetup, loading, profile?.identityVerificationRequired, profile?.identityVerificationVerified, profile?.status, router, selectedPlanKey, success, user]);

  const stripePromise = useMemo(() => billingPlatform === "stripe" && configuration?.publishableKey ? loadStripe(configuration.publishableKey) : null, [billingPlatform, configuration?.publishableKey]);
  const elementOptions = useMemo(() => configuration?.clientSecret ? {
    clientSecret: configuration.clientSecret,
    appearance: { theme: "stripe", variables: { colorPrimary: "#020617", borderRadius: "12px" } },
  } : null, [configuration?.clientSecret]);

  return <>
    <main className="ark-auth-page grid min-h-screen place-items-center px-5 py-10">
      <section className="ark-auth-card w-full max-w-xl rounded-3xl p-6 shadow-2xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 4 of 4 · Payment</p>
        {!success && !checking && billingPlatform !== "checking" && <div className="mt-6"><PlanSelector selectedPlanKey={selectedPlanKey} onSelect={selectPlan} promotion={promotion} disabled={leaving} /></div>}
        {success ? <p id="success-message" className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-lg font-black text-emerald-900" role="status">Payment setup complete</p>
          : checking ? <p className="mt-8 text-center text-sm font-bold text-slate-600">Confirming payment…</p>
            : billingPlatform === "apple" && configuration ? <div className="mt-7"><ApplePaymentForm configuration={configuration} user={user} onSucceeded={completeAppleSetup} /></div>
              : billingPlatform === "stripe" && configuration && stripePromise && elementOptions ? <div className="mt-7"><Elements stripe={stripePromise} options={elementOptions}><PaymentForm clientSecret={configuration.clientSecret} returnUrl={configuration.returnUrl} selectedPlan={selectedPaymentPlan} promotion={promotion} onSucceeded={completeSetup} onDeclined={cancelDeclinedSignup} /></Elements></div>
                : !error ? <p className="mt-8 text-center text-sm font-bold text-slate-600">{billingPlatform === "apple" ? "Opening Apple purchase…" : billingPlatform === "stripe" ? "Opening secure payment fields…" : "Checking this device…"}</p> : null}
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
