"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { dashBusinessName } from "../lib/valueUtils";

const PLANS = [
  {
    key: "solo",
    name: "Solo",
    price: "$100/month",
    description: "50 leads included each month, then $5 per additional lead.",
    details: ["50 free leads", "$5 per lead after 50"],
  },
  {
    key: "solo_pro",
    name: "Solo Pro",
    price: "$200/month",
    description: "50 leads and 50 new lead conversations included each month.",
    details: ["50 free leads", "50 free conversations", "$5 per extra lead or conversation", "Texts inside a conversation are included"],
  },
];

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    businessName: "",
    ownerName: "",
    accountEmail: "",
    accountPhone: "",
    password: "",
    confirmPassword: "",
    billingPlan: "solo",
  });
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(event) {
    const value = event.target.name === "businessName" ? dashBusinessName(event.target.value) : event.target.value;
    setForm((current) => ({ ...current, [event.target.name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    if (!acceptedLegal) {
      setError("You must agree to the Terms of Use and Privacy Policy before continuing.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/signup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName,
          ownerName: form.ownerName,
          accountEmail: form.accountEmail,
          accountPhone: form.accountPhone,
          password: form.password,
          billingPlan: form.billingPlan,
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        }),
      });
      const data = await readApiJson(response, "Unable to submit the account for verification.");
      await signInWithEmailAndPassword(auth, data.email, form.password);
      router.replace("/signup/status");
    } catch (signupError) {
      setError(signupError.message);
      setSubmitting(false);
    }
  }

  const selectedPlan = PLANS.find((plan) => plan.key === form.billingPlan) || PLANS[0];
  const billingAgreement = form.billingPlan === "solo_pro"
    ? "$200 per month with 50 leads and 50 new lead conversations included, then $5 for each additional lead or conversation. Individual texts inside a conversation are not charged separately."
    : "$100 per month with 50 leads included, then $5 for each additional lead.";

  return (
    <main className="min-h-screen bg-slate-950 p-5 py-10">
      <div className="mx-auto w-full max-w-2xl rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK OCM</p>
        <h1 className="mt-3 text-3xl font-bold">Make an account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Choose a Solo plan, enter the business information, and create a password. ARK verifies the account before payment setup is available.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-black text-slate-950">Choose your plan</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {PLANS.map((plan) => {
                const selected = form.billingPlan === plan.key;
                return (
                  <button
                    key={plan.key}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, billingPlan: plan.key }))}
                    className={selected
                      ? "rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-left text-white shadow-lg"
                      : "rounded-2xl border-2 border-slate-200 bg-white p-5 text-left text-slate-950 hover:border-slate-400"}
                    aria-pressed={selected}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xl font-black">{plan.name}</p>
                        <p className={selected ? "mt-1 text-sm font-black text-white" : "mt-1 text-sm font-black text-slate-700"}>{plan.price}</p>
                      </div>
                      <span className={selected ? "rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950" : "rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500"}>
                        {selected ? "Selected" : "Choose"}
                      </span>
                    </div>
                    <p className={selected ? "mt-3 text-sm leading-6 text-slate-200" : "mt-3 text-sm leading-6 text-slate-600"}>{plan.description}</p>
                    <ul className={selected ? "mt-3 space-y-1 text-xs font-bold text-slate-200" : "mt-3 space-y-1 text-xs font-bold text-slate-600"}>
                      {plan.details.map((detail) => <li key={detail}>• {detail}</li>)}
                    </ul>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Business name</span>
            <input required name="businessName" autoComplete="organization" value={form.businessName} onChange={updateField} placeholder="Your business name" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
            <span className="mt-1.5 block text-xs font-semibold text-slate-400">Spaces are changed to dashes automatically for the account name.</span>
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Your name</span>
            <input required name="ownerName" autoComplete="name" value={form.ownerName} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Business email</span>
            <input required type="email" name="accountEmail" autoComplete="email" value={form.accountEmail} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Business phone</span>
            <input required type="tel" name="accountPhone" autoComplete="tel" value={form.accountPhone} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Password</span>
            <input required minLength={8} type="password" name="password" autoComplete="new-password" value={form.password} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Confirm password</span>
            <input required minLength={8} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <p className="text-sm font-black text-slate-950">Selected: {selectedPlan.name}</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">{billingAgreement}</p>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <input required type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-slate-950" />
            <span className="text-sm leading-6 text-slate-700">
              I have read and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Privacy Policy</Link>, including recurring billing under the selected {selectedPlan.name} plan: {billingAgreement}
            </span>
          </label>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}

          <button disabled={submitting || !acceptedLegal} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">
            {submitting ? "Submitting for verification…" : `Submit ${selectedPlan.name} for verification`}
          </button>
        </form>

        <p className="mt-4 text-center text-xs leading-5 text-slate-500">
          Payment details are not requested until ARK approves the account. App access starts only after approval and successful payment setup.
        </p>
        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">
          Already submitted? Log in
        </Link>
        <div className="mt-4 flex justify-center gap-4 text-xs font-bold text-slate-500">
          <Link href="/about" className="hover:text-slate-950">About</Link>
          <Link href="/support" className="hover:text-slate-950">Support</Link>
          <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
        </div>
      </div>
    </main>
  );
}
