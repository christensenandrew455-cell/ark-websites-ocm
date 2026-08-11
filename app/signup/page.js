"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { clearOwnerSignupDraft, loadOwnerSignupDraft, saveOwnerSignupDraft } from "../lib/ownerSignupStorage";
import { dashBusinessName } from "../lib/valueUtils";

function formatPhoneInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function ChoiceButton({ selected, title, priceLabel, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className={selected ? "rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-left text-white shadow-lg" : "rounded-2xl border-2 border-slate-200 bg-white p-5 text-left text-slate-950 hover:border-slate-400"} aria-pressed={selected}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-black">{title}</p>
          <p className={selected ? "mt-1 text-xs font-black uppercase tracking-wide text-slate-300" : "mt-1 text-xs font-black uppercase tracking-wide text-slate-500"}>{priceLabel}</p>
        </div>
        <span className={selected ? "rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-950" : "rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500"}>{selected ? "Selected" : "Choose"}</span>
      </div>
      <p className={selected ? "mt-3 text-sm leading-6 text-slate-200" : "mt-3 text-sm leading-6 text-slate-600"}>{description}</p>
    </button>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [accountType, setAccountType] = useState("owner");
  const [form, setForm] = useState({ businessName: "", personName: "", accountEmail: "", accountPhone: "", password: "", confirmPassword: "", referrerAccountId: "" });
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const draft = loadOwnerSignupDraft();
    if (!draft) return;
    setForm({
      businessName: draft.businessName,
      personName: draft.ownerName,
      accountEmail: draft.accountEmail,
      accountPhone: draft.accountPhone,
      password: draft.password,
      confirmPassword: draft.password,
      referrerAccountId: draft.referrerAccountId,
    });
    setAcceptedLegal(draft.acceptedTerms && draft.acceptedPrivacy);
  }, []);

  function updateField(event) {
    const { name } = event.target;
    const value = name === "businessName" || name === "referrerAccountId"
      ? dashBusinessName(event.target.value)
      : name === "accountPhone"
        ? formatPhoneInput(event.target.value)
        : event.target.value;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (form.accountPhone.replace(/\D/g, "").length !== 10) return setError("Enter a 10-digit phone number.");
    if (form.password.length < 8) return setError("Use a password with at least 8 characters.");
    if (form.password !== form.confirmPassword) return setError("The two passwords do not match.");
    if (!acceptedLegal) return setError("You must agree to the Terms of Use and Privacy Policy before continuing.");
    const employeeSignup = accountType === "employee";
    setSubmitting(true);
    try {
      if (!employeeSignup) {
        const current = loadOwnerSignupDraft();
        saveOwnerSignupDraft({
          ...current,
          businessName: form.businessName,
          ownerName: form.personName,
          accountEmail: form.accountEmail,
          accountPhone: form.accountPhone,
          password: form.password,
          referrerAccountId: form.referrerAccountId,
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
          receptionist: {
            ...(current?.receptionist || {}),
            businessName: form.businessName,
            ownerName: form.personName,
            businessEmail: form.accountEmail,
            businessPhone: form.accountPhone,
          },
        });
        router.push("/setup/business?signup=1");
        return;
      }

      clearOwnerSignupDraft();
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
          referrerAccountId: form.referrerAccountId,
        }),
      });
      const data = await readApiJson(response, "Unable to create the account.");
      await signInWithEmailAndPassword(auth, data.email, form.password);
      router.replace("/employee/pending");
    } catch (signupError) {
      setError(signupError.message);
      setSubmitting(false);
    }
  }

  const employeeSignup = accountType === "employee";

  return (
    <main className="min-h-screen bg-slate-950 p-5 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK Client Center</p>
        <h1 className="mt-3 text-3xl font-bold">Make an account</h1>
        {!employeeSignup && <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 1 of 4 · Account information</p>}
        <p className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-semibold leading-6 text-indigo-950">Enter the business and account information below. Owner accounts continue through business information, About, and Payment Method. The account is created only after the payment method is added.</p>

        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-black text-slate-950">Choose an account type</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ChoiceButton selected={accountType === "owner"} title="Owner account" priceLabel="Paid" description="Make an account as a business owner." onClick={() => { setAccountType("owner"); setError(""); }} />
              <ChoiceButton selected={accountType === "employee"} title="Employee account" priceLabel="Free" description="Make an account as an employee and join your business." onClick={() => { setAccountType("employee"); setError(""); }} />
            </div>
          </fieldset>

          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">Business name</span><input required name="businessName" autoComplete="organization" value={form.businessName} onChange={updateField} placeholder="Your business name" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee name" : "Owner name"}</span><input required name="personName" autoComplete="name" value={form.personName} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee email" : "Account email"}</span><input required type="email" name="accountEmail" autoComplete="email" value={form.accountEmail} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">{employeeSignup ? "Employee phone" : "Account phone"}</span><input required type="tel" inputMode="numeric" maxLength={14} name="accountPhone" autoComplete="tel" value={form.accountPhone} onChange={updateField} placeholder="(555) 555-5555" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Password</span><input required minLength={8} type="password" name="password" autoComplete="new-password" value={form.password} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Confirm password</span><input required minLength={8} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          {!employeeSignup && <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">Account that referred you <span className="font-normal text-slate-500">(optional)</span></span><input name="referrerAccountId" autoComplete="off" value={form.referrerAccountId} onChange={updateField} placeholder="Business-Account-ID" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>}

          {employeeSignup && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-sm font-black text-slate-950">Owner approval required</p><p className="mt-1 text-sm leading-6 text-slate-700">The business owner must approve your account before you can sign in.</p></div>}
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><input required type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-slate-950" /><span className="text-sm leading-6 text-slate-700">I have read and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Privacy Policy</Link>.</span></label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}
          <button disabled={submitting || !acceptedLegal} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">{submitting ? (employeeSignup ? "Creating account…" : "Opening business information…") : employeeSignup ? "Create Employee Account" : "Next"}</button>
        </form>
        <Link href="/login" onClick={clearOwnerSignupDraft} className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">Already have an account? Sign in</Link>
      </div>
    </main>
  );
}
