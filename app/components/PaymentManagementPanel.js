"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readApiJson } from "../lib/apiResponse";
import { SIMPLE_CARD_ELEMENT_OPTIONS, simpleCardConfirmParams } from "../lib/stripeElementOptions";
import {
  appleIapAvailable,
  finishAppleTransaction,
  manageAppleSubscriptions,
  purchaseWithApple,
  unfinishedAppleTransactions,
} from "../lib/appleIapClient";
import SubscriptionPlanCard, { formatUsd } from "./SubscriptionPlanCard";
import InfoTip from "./InfoTip";

function dateLabel(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime())
    ? "your next renewal"
    : date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function authenticatedJson(user, url, options = {}) {
  const token = await user.getIdToken(true);
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  return readApiJson(response);
}

function Accordion({ title, open, onToggle, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white">
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-6">
      <span className="block text-lg font-black text-slate-950">{title}</span>
      <span aria-hidden="true" className="text-2xl font-black text-slate-500">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="border-t border-slate-200 p-5 sm:p-6">{children}</div>}
  </section>;
}

function PaymentMethodForm({ configuration, user, onSaved }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError("");
    try {
      const submitted = await elements.submit();
      if (submitted.error) throw submitted.error;
      const confirmed = await stripe.confirmSetup({
        elements,
        clientSecret: configuration.clientSecret,
        confirmParams: simpleCardConfirmParams(configuration.returnUrl),
        redirect: "if_required",
      });
      if (confirmed.error || !confirmed.setupIntent?.id) throw confirmed.error || new Error("The card was not confirmed.");
      const result = await authenticatedJson(user, "/api/billing/payment-method", {
        method: "PUT",
        body: JSON.stringify({ setupIntentId: confirmed.setupIntent.id }),
      });
      onSaved(result.paymentMethodLabel);
    } catch (saveError) {
      setError(String(saveError?.message || "The card could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="space-y-5">
    <div className="flex items-center gap-2 text-sm font-black text-slate-800">Card details <InfoTip label="How this card is used">This becomes the default card for renewals, immediate plan changes, and lead top-ups.</InfoTip></div>
    <PaymentElement options={SIMPLE_CARD_ELEMENT_OPTIONS} />
    <button type="submit" disabled={!stripe || !elements || busy} className="w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? "Saving…" : "Save card"}</button>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
  </form>;
}

function StripeCardEditor({ user, onSaved }) {
  const [configuration, setConfiguration] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const completeReturnedSetup = useCallback(async (setupIntentId) => {
    const result = await authenticatedJson(user, "/api/billing/payment-method", {
      method: "PUT",
      body: JSON.stringify({ setupIntentId }),
    });
    setNotice("Card information updated.");
    onSaved(result.paymentMethodLabel);
  }, [onSaved, user]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const parameters = new URLSearchParams(window.location.search);
        const returnedSetupIntent = parameters.get("setup_intent");
        if (returnedSetupIntent) {
          await completeReturnedSetup(returnedSetupIntent);
          window.history.replaceState({}, "", "/settings?section=payment&manage=card");
        }
        const data = await authenticatedJson(user, "/api/billing/payment-method", { method: "POST" });
        if (active) setConfiguration(data);
      } catch (loadError) {
        if (active) setError(String(loadError?.message || "Secure card fields could not open. Try again."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [completeReturnedSetup, user]);

  const stripePromise = useMemo(() => configuration?.publishableKey ? loadStripe(configuration.publishableKey) : null, [configuration?.publishableKey]);
  const options = useMemo(() => configuration?.clientSecret ? {
    clientSecret: configuration.clientSecret,
    appearance: { theme: "stripe", variables: { colorPrimary: "#1e40af", borderRadius: "12px" } },
  } : null, [configuration?.clientSecret]);

  if (loading) return <p className="text-sm font-bold text-slate-600">Opening secure card fields…</p>;
  return <div>
    {notice && <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800" role="status">{notice}</p>}
    {configuration && stripePromise && options && <Elements stripe={stripePromise} options={options}><PaymentMethodForm configuration={configuration} user={user} onSaved={(label) => { setNotice("Card information updated."); onSaved(label); }} /></Elements>}
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
  </div>;
}

function PlanConfirmation({ plan, currentPlan, timing, setTiming, renewalDate, appleBilling, busy, onCancel, onConfirm }) {
  if (!plan) return null;
  return <div className="fixed inset-0 z-[260] grid place-items-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-plan-title">
    <section className="w-full max-w-lg rounded-3xl bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
      <h2 id="confirm-plan-title" className="text-2xl font-black">Change to {plan.name}?</h2>
      <p className="mt-2 text-sm font-bold text-slate-600">{formatUsd(plan.effectiveAmountCents)}/month · {plan.monthlyAcceptedLeads} accepted leads</p>
      {appleBilling ? <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">Apple shows the final price and start date before you confirm.</p>
        : <fieldset className="mt-5 space-y-3"><legend className="text-sm font-black">When should {plan.name} start?</legend>
          <label className={`block rounded-2xl border p-4 ${timing === "renewal" ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}><input type="radio" name="plan-timing" value="renewal" checked={timing === "renewal"} onChange={() => setTiming("renewal")} className="mr-3 accent-blue-800" /><span className="text-sm font-black">At renewal · {renewalDate}</span><span className="mt-1 block pl-7 text-xs font-semibold leading-5 text-slate-600">Keep {currentPlan} until then. No charge today.</span></label>
          <label className={`block rounded-2xl border p-4 ${timing === "now" ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}><input type="radio" name="plan-timing" value="now" checked={timing === "now"} onChange={() => setTiming("now")} className="mr-3 accent-blue-800" /><span className="text-sm font-black">Now · pay {formatUsd(plan.effectiveAmountCents)}</span><span className="mt-1 block pl-7 text-xs font-semibold leading-5 text-slate-600">Your billing month restarts. Unused leads expire and are not refunded.</span></label>
        </fieldset>}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-blue-800 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? "Confirming…" : appleBilling ? "Continue with Apple" : timing === "now" ? `Pay ${formatUsd(plan.effectiveAmountCents)} and switch` : "Schedule change"}</button>
      </div>
    </section>
  </div>;
}

export default function PaymentManagementPanel({
  user,
  planSummary,
  billingProvider,
  nativeIos,
  initialPanel = "",
  onChanged,
  onPaymentMethodChanged,
  onClose,
}) {
  const appleBilling = billingProvider === "apple";
  const stripeInsideIos = nativeIos && !appleBilling;
  const [openPanel, setOpenPanel] = useState(["plan", "topup", "card"].includes(initialPanel) ? initialPanel : "");
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [timing, setTiming] = useState("renewal");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [appleConfiguration, setAppleConfiguration] = useState(null);
  const [topUpQuantity, setTopUpQuantity] = useState(initialPanel === "topup" ? "20" : "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const appleResumeStarted = useRef(false);
  const renewalDate = dateLabel(planSummary?.periodEndAt);
  const topUpNumber = Number(topUpQuantity);
  const validTopUp = Number.isSafeInteger(topUpNumber) && topUpNumber > 0 && topUpNumber <= 999_999;

  const plans = useMemo(() => (planSummary?.plans || []).map((plan) => ({
    ...plan,
    effectiveAmountCents: Number(plan.promotionalAmountCents || plan.amountCents),
  })), [planSummary?.plans]);

  const refreshAppleConfiguration = useCallback(async () => {
    if (!appleBilling || !user) return null;
    const data = await authenticatedJson(user, "/api/billing/apple/configuration");
    setAppleConfiguration(data);
    return data;
  }, [appleBilling, user]);

  useEffect(() => {
    if (appleBilling && ["plan", "topup"].includes(openPanel) && !appleConfiguration) {
      refreshAppleConfiguration().catch((loadError) => setError(String(loadError?.message || "Apple billing could not open.")));
    }
  }, [appleBilling, appleConfiguration, openPanel, refreshAppleConfiguration]);

  useEffect(() => {
    if (!appleConfiguration || appleResumeStarted.current) return;
    appleResumeStarted.current = true;
    (async () => {
      const unfinished = await unfinishedAppleTransactions(appleConfiguration.productIds || []);
      let addedLeads = 0;
      let restoredPlan = false;
      for (const purchase of unfinished.transactions || []) {
        const settled = await authenticatedJson(user, "/api/billing/apple/transactions", {
          method: "POST",
          body: JSON.stringify({ signedTransaction: purchase.signedTransaction }),
        });
        await finishAppleTransaction(purchase.transactionId).catch(() => null);
        addedLeads += Number(settled.acceptedLeadsAdded || 0);
        restoredPlan = restoredPlan || settled.kind === "subscription";
      }
      if (addedLeads || restoredPlan) {
        setNotice(addedLeads ? `${addedLeads} previously purchased leads are ready to use.` : "Apple finished the pending plan change.");
        await onChanged();
      }
    })().catch((resumeError) => {
      appleResumeStarted.current = false;
      setError(String(resumeError?.message || "An unfinished Apple purchase could not be verified."));
    });
  }, [appleConfiguration, onChanged, user]);

  const finishReturnedPayment = useCallback(async () => {
    if (!user || appleBilling) return;
    const parameters = new URLSearchParams(window.location.search);
    const resume = parameters.get("resume");
    if (resume === "topup" && parameters.get("payment_intent")) {
      await authenticatedJson(user, "/api/billing/top-up", {
        method: "PUT",
        body: JSON.stringify({ paymentIntentId: parameters.get("payment_intent") }),
      });
      setNotice("Additional leads are ready to use.");
      await onChanged();
      window.history.replaceState({}, "", "/settings?section=payment&manage=topup");
    }
    if (resume === "plan" && parameters.get("subscriptionId") && parameters.get("planKey")) {
      await authenticatedJson(user, "/api/billing/change-plan", {
        method: "PUT",
        body: JSON.stringify({ subscriptionId: parameters.get("subscriptionId"), planKey: parameters.get("planKey") }),
      });
      setNotice("Your new plan is active.");
      await onChanged();
      window.history.replaceState({}, "", "/settings?section=payment&manage=plan");
    }
  }, [appleBilling, onChanged, user]);

  useEffect(() => {
    finishReturnedPayment().catch((resumeError) => setError(String(resumeError?.message || "The payment could not be verified.")));
  }, [finishReturnedPayment]);

  async function confirmStripePayment(data, returnUrl) {
    const stripe = await loadStripe(data.publishableKey);
    if (!stripe) throw new Error("Secure payment confirmation could not open.");
    const confirmed = await stripe.confirmPayment({
      clientSecret: data.clientSecret,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });
    if (confirmed.error) throw confirmed.error;
  }

  async function confirmPlanChange() {
    if (!selectedPlan || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (appleBilling) {
        const configuration = appleConfiguration || await refreshAppleConfiguration();
        const applePlan = configuration.plans.find((plan) => plan.key === selectedPlan.key);
        if (!applePlan) throw new Error("That Apple plan is not available.");
        const purchase = await purchaseWithApple({ productId: applePlan.productId, appAccountToken: configuration.appAccountToken });
        if (purchase.status === "cancelled") { setNotice("The Apple plan change was canceled. No change was made."); return; }
        if (purchase.status === "pending") { setNotice("Apple is reviewing the plan change. It will apply after Apple approves it."); return; }
        const result = await authenticatedJson(user, "/api/billing/apple/transactions", {
          method: "POST",
          body: JSON.stringify({ signedTransaction: purchase.signedTransaction }),
        });
        await finishAppleTransaction(purchase.transactionId).catch(() => null);
        if (result.status !== "succeeded") throw new Error("Apple did not complete the plan change.");
        setNotice("Apple confirmed the plan change.");
      } else {
        const data = await authenticatedJson(user, "/api/billing/change-plan", {
          method: "POST",
          body: JSON.stringify({ planKey: selectedPlan.key, timing, requestId: requestId() }),
        });
        if (data.status === "requires_action") {
          const returnUrl = `${window.location.origin}/settings?section=payment&manage=plan&resume=plan&subscriptionId=${encodeURIComponent(data.subscriptionId)}&planKey=${encodeURIComponent(selectedPlan.key)}`;
          await confirmStripePayment(data, returnUrl);
          await authenticatedJson(user, "/api/billing/change-plan", {
            method: "PUT",
            body: JSON.stringify({ subscriptionId: data.subscriptionId, planKey: selectedPlan.key }),
          });
          setNotice(`${selectedPlan.name} is active. Your allowance and billing month restarted.`);
        } else if (data.status === "scheduled") {
          setNotice(`${selectedPlan.name} will start on ${dateLabel(data.startsAt)}. No charge was made today.`);
        } else {
          setNotice(`${selectedPlan.name} is active. Your allowance and billing month restarted.`);
        }
      }
      setConfirmationOpen(false);
      setSelectedPlan(null);
      await onChanged();
    } catch (changeError) {
      setError(String(changeError?.message || "The plan change could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function buyTopUp() {
    if (!validTopUp || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (appleBilling) {
        const configuration = appleConfiguration || await refreshAppleConfiguration();
        const productId = configuration.acceptedLeadTopUp?.productId;
        if (!productId) throw new Error("The Apple lead top-up is not configured yet.");
        let remaining = topUpNumber;
        let purchased = 0;
        while (remaining > 0) {
          const purchaseQuantity = Math.min(10, remaining);
          const purchase = await purchaseWithApple({ productId, appAccountToken: configuration.appAccountToken, quantity: purchaseQuantity });
          if (purchase.status === "cancelled") {
            setNotice(purchased > 0
              ? `${purchased} additional leads were added. The remaining Apple purchase was canceled.`
              : "The Apple top-up was canceled. No charge was made.");
            if (purchased > 0) await onChanged();
            return;
          }
          if (purchase.status === "pending") {
            setNotice(`${purchased > 0 ? `${purchased} leads were added. ` : ""}Apple is reviewing the remaining purchase and will add those leads after approval.`);
            if (purchased > 0) await onChanged();
            return;
          }
          const settled = await authenticatedJson(user, "/api/billing/apple/transactions", {
            method: "POST",
            body: JSON.stringify({ signedTransaction: purchase.signedTransaction }),
          });
          await finishAppleTransaction(purchase.transactionId).catch(() => null);
          purchased += Number(settled.acceptedLeadsAdded || purchaseQuantity);
          remaining -= purchaseQuantity;
        }
      } else {
        const data = await authenticatedJson(user, "/api/billing/top-up", {
          method: "POST",
          body: JSON.stringify({ acceptedLeads: topUpNumber, requestId: requestId() }),
        });
        if (data.status === "requires_action") {
          const returnUrl = `${window.location.origin}/settings?section=payment&manage=topup&resume=topup`;
          await confirmStripePayment(data, returnUrl);
          await authenticatedJson(user, "/api/billing/top-up", {
            method: "PUT",
            body: JSON.stringify({ paymentIntentId: data.paymentIntentId }),
          });
        }
      }
      setNotice(`${topUpNumber} additional accepted leads are ready to use.`);
      setTopUpQuantity("");
      await onChanged();
    } catch (topUpError) {
      setError(String(topUpError?.message || "The lead top-up could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function applyRewardCredits() {
    if (busy || !planSummary?.limitReached || Number(planSummary?.rewardLeadCreditBalance || 0) < 5) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await authenticatedJson(user, "/api/billing/reward-credits", {
        method: "POST",
        body: JSON.stringify({ requestId: requestId() }),
      });
      setNotice(`${data.acceptedLeadsAdded || 5} free lead credits are ready to use this billing month.`);
      await onChanged();
    } catch (rewardError) {
      setError(String(rewardError?.message || "Free lead credits could not be applied."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className="rounded-2xl border border-slate-200 bg-slate-100/70 p-3 shadow-sm sm:rounded-3xl sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-blue-900 p-4 text-white">
        <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-200">Current plan</p><p className="mt-1 text-xl font-black">{planSummary?.planName || "Starter"} Plan</p></div>
        <button type="button" onClick={onClose} className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-xs font-black">Done</button>
      </div>
      {notice && <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800" role="status">{notice}</p>}
      {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
      {stripeInsideIos && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">This Stripe account can be viewed here, but billing changes must be completed on the ARK website outside the iPhone app.</p>}
      <div className="space-y-3">
        <Accordion title="Change plan" open={openPanel === "plan"} onToggle={() => setOpenPanel((current) => current === "plan" ? "" : "plan")}>
          {planSummary?.pendingBillingPlanKey && <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-900">{planSummary.pendingBillingPlanName} is scheduled for {dateLabel(planSummary.pendingBillingPlanStartsAt)}.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => {
              const current = plan.key === planSummary?.planKey;
              const chosen = plan.key === selectedPlan?.key;
              return <button key={plan.key} type="button" disabled={current || stripeInsideIos || busy} onClick={() => { setSelectedPlan(plan); setNotice(""); setError(""); }} className={`rounded-2xl border p-4 text-left disabled:opacity-60 ${chosen ? "border-blue-600 bg-blue-50 ring-2 ring-blue-200" : current ? "border-slate-300 bg-slate-100" : "border-slate-200 bg-white"}`}>
                <SubscriptionPlanCard plan={plan} promotionalAmountCents={plan.promotionalAmountCents} />
                <span className={`mt-3 block text-xs font-black ${current ? "text-slate-600" : chosen ? "text-blue-700" : "text-slate-500"}`}>{current ? "Current" : chosen ? "Selected" : "Choose"}</span>
              </button>;
            })}
          </div>
          {appleBilling && appleIapAvailable() && <button type="button" onClick={() => manageAppleSubscriptions().catch((manageError) => setError(String(manageError?.message || "Apple subscription settings could not open.")))} className="mt-5 w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800">Open Apple Subscription Settings</button>}
          {selectedPlan && <button type="button" disabled={busy} onClick={() => setConfirmationOpen(true)} className="mt-4 w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-black text-white disabled:opacity-50">Continue with {selectedPlan.name}</button>}
        </Accordion>
        <Accordion title="Add leads" open={openPanel === "topup"} onToggle={() => setOpenPanel((current) => current === "topup" ? "" : "topup")}>
          <p className="text-sm font-bold text-slate-700">$1 each · available until {renewalDate}</p>
          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black text-violet-900">Free leads</p><p className="mt-1 text-2xl font-black text-violet-950">{Number(planSummary?.rewardLeadCreditBalance || 0).toLocaleString("en-US")}</p></div><button type="button" disabled={busy || !planSummary?.limitReached || Number(planSummary?.rewardLeadCreditBalance || 0) < 5} onClick={applyRewardCredits} className="rounded-xl bg-violet-800 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Use 5 free leads</button></div>
            <div className="mt-2 flex items-center gap-2 text-xs font-bold text-violet-900">Available when your plan reaches zero <InfoTip label="Using free leads">Free leads stay in Rewards until your monthly plan reaches zero. Then you can use five at a time.</InfoTip></div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1"><span className="mb-2 block text-xs font-black text-slate-700">Leads to add</span><input inputMode="numeric" type="number" min="1" step="1" value={topUpQuantity} disabled={stripeInsideIos || busy} onChange={(event) => setTopUpQuantity(event.target.value)} placeholder="20" className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-black outline-none focus:border-blue-700" /></label><button type="button" disabled={!validTopUp || stripeInsideIos || busy} onClick={buyTopUp} className="h-12 rounded-xl bg-slate-950 px-5 text-sm font-black text-white disabled:opacity-40">{busy ? "Confirming…" : validTopUp ? `Buy for ${formatUsd(topUpNumber * 100)}` : "Enter an amount"}</button></div>
        </Accordion>
        <Accordion title="Payment card" open={openPanel === "card"} onToggle={() => setOpenPanel((current) => current === "card" ? "" : "card")}>
          {appleBilling ? <div><div className="flex items-center gap-2 text-sm font-black text-slate-800">Managed by Apple <InfoTip label="About Apple billing">Update the card in your Apple Account’s Payment & Shipping settings. ARK does not receive the full card number.</InfoTip></div><a href="https://apps.apple.com/account/billing" target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Open Apple payment settings</a></div>
            : stripeInsideIos ? <a href="https://www.arkclientcenter.com/settings?section=payment&manage=card" target="_blank" rel="noreferrer" className="inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Open Secure Website</a>
              : <StripeCardEditor user={user} onSaved={onPaymentMethodChanged} />}
        </Accordion>
      </div>
    </section>
    {confirmationOpen && <PlanConfirmation plan={selectedPlan} currentPlan={`${planSummary?.planName || "Starter"} Plan`} timing={timing} setTiming={setTiming} renewalDate={renewalDate} appleBilling={appleBilling} busy={busy} onCancel={() => !busy && setConfirmationOpen(false)} onConfirm={confirmPlanChange} />}
  </>;
}
