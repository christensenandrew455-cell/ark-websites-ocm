"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { dashBusinessName } from "../lib/valueUtils";

const SOLO_PLANS = [
  {
    key: "solo",
    name: "Solo",
    price: "$100/month",
    description: "50 leads included each month, then $5 per additional lead.",
    details: ["50 included leads", "$5 per lead after 50"],
  },
  {
    key: "solo_pro",
    name: "Solo Pro",
    price: "$200/month",
    description: "50 leads and 50 new lead conversations included each month.",
    details: ["50 included leads", "50 included conversations", "$5 per extra lead or conversation", "Texts inside the same conversation are included"],
  },
];

const BUSINESS_PLAN = {
  key: "business",
  name: "Business",
  price: "$300/month",
  description: "A business owner workspace with employee accounts, lead routing, and messaging.",
  details: ["75 included leads", "75 included conversations", "3 active employees included", "$5 per extra lead or conversation", "$25 per additional active employee"],
};

function ChoiceButton({ selected, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={selected
        ? "rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-left text-white shadow-lg"
        : "rounded-2xl border-2 border-slate-200 bg-white p-5 text-left text-slate-950 hover:border-slate-400"}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xl font-black">{title}</p>
        <span className={selected ? "rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950" : "rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500"}>
          {selected ? "Selected" : "Choose"}
        </span>
      </div>
      <p className={selected ? "mt-3 text-sm leading-6 text-slate-200" : "mt-3 text-sm leading-6 text-slate-600"}>{description}</p>
    </button>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [accountSide, setAccountSide] = useState("solo");
  const [businessSignupType, setBusinessSignupType] = useState("owner");
  const [form, setForm] = useState({
    businessName: "",
    personName: "",
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

  function chooseAccountSide(value) {
    setAccountSide(value);
    setError("");
    if (value === "business") setForm((current) => ({ ...current, billingPlan: "business" }));
    else setForm((current) => ({ ...current, billingPlan: current.billingPlan === "business" ? "solo" : current.billingPlan }));
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

    const employeeSignup = accountSide === "business" && businessSignupType === "employee";
    setSubmitting(true);
    try {
      const response = await fetch(employeeSignup ? "/api/signup/employee" : "/api/signup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(employeeSignup ? {
          businessName: form.businessName,
          employeeName: form.personName,
          accountEmail: form.accountEmail,
          accountPhone: form.accountPhone,
          password: form.password,
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        } : {
          businessName: form.businessName,
          ownerName: form.personName,
          accountEmail: form.accountEmail,
          accountPhone: form.accountPhone,
          password: form.password,
          billingPlan: accountSide === "business" ? "business" : form.billingPlan,
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        }),
      });
      const data = await readApiJson(response, "Unable to create the account.");
      await signInWithEmailAndPassword(auth, data.email, form.password);
      router.replace(employeeSignup ? "/employee/pending" : "/signup/status");
    } catch (signupError) {
      setError(signupError.message);
      setSubmitting(false);
    }
  }

  const employeeSignup = accountSide === "business" && businessSignupType === "employee";
  const selectedPlan = accountSide === "business"
    ? BUSINESS_PLAN
    : SOLO_PLANS.find((plan) => plan.key === form.billingPlan) || SOLO_PLANS[0];
  const billingAgreement = selectedPlan.key === "business"
    ? "$300 per month with 75 leads, 75 new lead conversations, and 3 active employee accounts included; then $5 per additional lead or conversation and $25 per additional active employee. Individual texts inside one conversation are not charged separately."
    : selectedPlan.key === "solo_pro"
      ? "$200 per month with 50 leads and 50 new lead conversations included, then $5 for each additional lead or conversation. Individual texts inside one conversation are not charged separately."
      : "$100 per month with 50 leads included, then $5 for each additional lead.";

  return (
    <main className="min-h-screen bg-slate-950 p-5 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK OCM</p>
        <h1 className="mt-3 text-3xl font-bold">Make an account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Start on the Solo side or the Business side. Business employees join an existing active Business account.</p>

        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-black text-slate-950">Is this Solo or Business?</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ChoiceButton selected={accountSide === "solo"} title="Solo" description="One owner account. Choose Solo or Solo Pro." onClick={() => chooseAccountSide("solo")} />
              <ChoiceButton selected={accountSide === "business"} title="Business" description="A business owner account with employees, lead routing, and conversations." onClick={() => chooseAccountSide("business")} />
            </div>
          </fieldset>

          {accountSide === "business" && (
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-black text-slate-950">What are you creating?</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ChoiceButton selected={businessSignupType === "owner"} title="Business account" description="Create and manage the business, employees, billing, and assignments." onClick={() => setBusinessSignupType("owner")} />
                <ChoiceButton selected={businessSignupType === "employee"} title="Employee account" description="Join an existing Business account. The business owner approves access." onClick={() => setBusinessSignupType("employee")} />
              </div>
            </fieldset>
          )}

          {accountSide === "solo" && (
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-black text-slate-950">Choose your Solo plan</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {SOLO_PLANS.map((plan) => {
                  const selected = form.billingPlan === plan.key;
                  return (
                    <button
                      key={plan.key}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, billingPlan: plan.key }))}
                      className={selected
                        ? "rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-left text-white shadow-lg"
                        : "rounded-2xl border-2 border-slate-200 bg-white p-5 text-left text-slate-950 hover:border-slate-400"}
                    >
                      <div className="flex items-start justify-between gap-3"><div><p className="text-xl font-black">{plan.name}</p><p className={selected ? "mt-1 text-sm font-black text-white" : "mt-1 text-sm font-black text-slate-700"}>{plan.price}</p></div><span className={selected ? "rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950" : "rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500"}>{selected ? "Selected" : "Choose"}</span></div>
                      <p className={selected ? "mt-3 text-sm leading-6 text-slate-200" : "mt-3 text-sm leading-6 text-slate-600"}>{plan.description}</p>
                      <ul className={selected ? "mt-3 space-y-1 text-xs font-bold text-slate-200" : "mt-3 space-y-1 text-xs font-bold text-slate-600"}>{plan.details.map((detail) => <li key={detail}>• {detail}</li>)}</ul>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {accountSide === "business" && businessSignupType === "owner" && (
            <section className="rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-white md:col-span-2">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xl font-black">{BUSINESS_PLAN.name}</p><p className="mt-1 text-sm font-black">{BUSINESS_PLAN.price}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950">Selected</span></div>
              <p className="mt-3 text-sm leading-6 text-slate-200">{BUSINESS_PLAN.description}</p>
              <ul className="mt-3 space-y-1 text-xs font-bold text-slate-200">{BUSINESS_PLAN.details.map((detail) => <li key={detail}>• {detail}</li>)}</ul>
            </section>
          )}

          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Business name</span>
            <input required name="businessName" autoComplete="organization" value={form.businessName} onChange={updateField} placeholder="Your business name" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
            <span className="mt-1.5 block text-xs font-semibold text-slate-400">Business names are unique regardless of capitalization. “Tabor Painting” and “tabor painting” count as the same business.</span>
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee name" : "Your name"}</span>
            <input required name="personName" autoComplete="name" value={form.personName} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee email" : "Business email"}</span>
            <input required type="email" name="accountEmail" autoComplete="email" value={form.accountEmail} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee phone" : "Business phone"}</span>
            <input required type="tel" name="accountPhone" autoComplete="tel" value={form.accountPhone} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
          </label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Password</span><input required minLength={8} type="password" name="password" autoComplete="new-password" value={form.password} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Confirm password</span><input required minLength={8} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <p className="text-sm font-black text-slate-950">{employeeSignup ? "Employee access" : `Selected: ${selectedPlan.name}`}</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">{employeeSignup ? "The business owner must approve the account. After approval, you only see assigned leads and the fields the owner allows." : billingAgreement}</p>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <input required type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-slate-950" />
            <span className="text-sm leading-6 text-slate-700">I have read and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Privacy Policy</Link>{employeeSignup ? ", including employee access controlled by the business owner." : `, including recurring billing under the selected ${selectedPlan.name} plan: ${billingAgreement}`}</span>
          </label>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}

          <button disabled={submitting || !acceptedLegal} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">
            {submitting ? "Creating account…" : employeeSignup ? "Create Employee Account" : `Submit ${selectedPlan.name} for verification`}
          </button>
        </form>

        <p className="mt-4 text-center text-xs leading-5 text-slate-500">Owner payment details are requested only after ARK approves the account. Employee accounts do not add their own payment method.</p>
        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">Already have an account? Sign in</Link>
      </div>
    </main>
  );
}
