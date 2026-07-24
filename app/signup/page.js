"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { dashBusinessName } from "../lib/valueUtils";

function ChoiceButton({ selected, title, description, onClick }) {
  return <button type="button" onClick={onClick} className={selected ? "rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-left text-white shadow-lg" : "rounded-2xl border-2 border-slate-200 bg-white p-5 text-left text-slate-950 hover:border-slate-400"} aria-pressed={selected}><div className="flex items-start justify-between gap-3"><p className="text-xl font-black">{title}</p><span className={selected ? "rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950" : "rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500"}>{selected ? "Selected" : "Choose"}</span></div><p className={selected ? "mt-3 text-sm leading-6 text-slate-200" : "mt-3 text-sm leading-6 text-slate-600"}>{description}</p></button>;
}

export default function SignupPage() {
  const router = useRouter();
  const [accountType, setAccountType] = useState("owner");
  const [form, setForm] = useState({ businessName: "", personName: "", accountEmail: "", accountPhone: "", password: "", confirmPassword: "" });
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
    if (form.password.length < 8) return setError("Use a password with at least 8 characters.");
    if (form.password !== form.confirmPassword) return setError("The two passwords do not match.");
    if (!acceptedLegal) return setError("You must agree to the Terms of Use and Privacy Policy before continuing.");
    const employeeSignup = accountType === "employee";
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

  const employeeSignup = accountType === "employee";
  const billingAgreement = "$50 per monthly billing period, plus $2 for each AI receptionist call or new lead. If Messages is enabled, each new lead conversation is $1 and additional texts in the same thread are included. If Employees is enabled, each active employee account is $5 per billing period.";

  return (
    <main className="min-h-screen bg-slate-950 p-5 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK OCM</p>
        <h1 className="mt-3 text-3xl font-bold">Make an account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Create the owner account for a business, or join an existing business as an employee.</p>

        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
          <fieldset className="md:col-span-2"><legend className="text-sm font-black text-slate-950">What type of account is this?</legend><div className="mt-3 grid gap-3 sm:grid-cols-2"><ChoiceButton selected={accountType === "owner"} title="Owner account" description="One $50 monthly account. Turn Messages and Employees on only when the business needs them." onClick={() => { setAccountType("owner"); setError(""); }} /><ChoiceButton selected={accountType === "employee"} title="Employee account" description="Join an existing account. The owner must enable Employees and approve access." onClick={() => { setAccountType("employee"); setError(""); }} /></div></fieldset>

          {!employeeSignup && <section className="rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-white md:col-span-2"><div className="flex items-start justify-between gap-3"><div><p className="text-xl font-black">ARK AI Receptionist</p><p className="mt-1 text-sm font-black">$50/month + usage</p></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950">One account</span></div><ul className="mt-3 space-y-1 text-xs font-bold text-slate-200"><li>• $2 per AI receptionist call or lead</li><li>• $1 per new message conversation when enabled</li><li>• $5 per active employee when enabled</li><li>• No separate Solo or Business plan</li></ul></section>}

          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">Business name</span><input required name="businessName" autoComplete="organization" value={form.businessName} onChange={updateField} placeholder="Your business name" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee name" : "Owner name"}</span><input required name="personName" autoComplete="name" value={form.personName} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee email" : "Account email"}</span><input required type="email" name="accountEmail" autoComplete="email" value={form.accountEmail} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee phone" : "Account phone"}</span><input required type="tel" name="accountPhone" autoComplete="tel" value={form.accountPhone} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Password</span><input required minLength={8} type="password" name="password" autoComplete="new-password" value={form.password} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Confirm password</span><input required minLength={8} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-sm font-black text-slate-950">{employeeSignup ? "Owner approval required" : "Straight to secure payment setup"}</p><p className="mt-1 text-sm leading-6 text-slate-700">{employeeSignup ? "The owner must enable Employees and approve this account. Employee charges belong to the owner account." : billingAgreement}</p></div>
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><input required type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-slate-950" /><span className="text-sm leading-6 text-slate-700">I have read and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Privacy Policy</Link>{employeeSignup ? ", including owner-controlled employee access." : `, including recurring and usage billing: ${billingAgreement}`}</span></label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}
          <button disabled={submitting || !acceptedLegal} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">{submitting ? "Creating account…" : employeeSignup ? "Create Employee Account" : "Create Owner Account"}</button>
        </form>
        <p className="mt-4 text-center text-xs leading-5 text-slate-500">Owner accounts continue directly to secure Stripe payment setup. Employee accounts never add their own payment method.</p>
        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">Already have an account? Sign in</Link>
      </div>
    </main>
  );
}
