"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { useState } from "react";
import PasswordInput from "../components/PasswordInput";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { dashBusinessName } from "../lib/valueUtils";
import { publicFormError } from "../lib/userFacingError";

function formatPhoneInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ businessName: "", ownerName: "", accountEmail: "", accountPhone: "", password: "", confirmPassword: "", referrerAccountId: "" });
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
          referrerAccountId: form.referrerAccountId,
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        }),
      });
      const data = await readApiJson(response, "Unable to create the account.");
      await signInWithCustomToken(auth, data.token);
      router.replace(data.nextPath || "/setup/business");
    } catch (signupError) {
      setError(publicFormError(signupError, "Unable to create the account right now."));
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] pt-10">
      <div className="mx-auto w-full max-w-3xl rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK Client Center</p>
        <h1 className="mt-3 text-3xl font-bold">Make an account</h1>
        <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 1 of 4 · Main information</p>
        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">Business name</span><input required name="businessName" autoComplete="organization" value={form.businessName} onChange={updateField} placeholder="Your business name" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">Owner name</span><input required name="ownerName" autoComplete="name" value={form.ownerName} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Account email</span><input required type="email" name="accountEmail" autoComplete="email" value={form.accountEmail} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Account phone</span><input required type="tel" inputMode="numeric" maxLength={14} name="accountPhone" autoComplete="tel" value={form.accountPhone} onChange={updateField} placeholder="(555) 555-5555" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Password</span><PasswordInput required minLength={8} name="password" autoComplete="new-password" value={form.password} onChange={updateField} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Confirm password</span><PasswordInput required minLength={8} name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={updateField} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>
          <label className="block md:col-span-2"><span className="text-sm font-semibold text-slate-700">Account that referred you <span className="font-normal text-slate-500">(optional)</span></span><input name="referrerAccountId" autoComplete="off" value={form.referrerAccountId} onChange={updateField} placeholder="Business-Account-ID" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" /></label>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><input required type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-slate-950" /><span className="text-sm leading-6 text-slate-700">I have read and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Privacy Policy</Link>.</span></label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
            <Link href="/login" className="rounded-xl border border-slate-300 px-5 py-3 text-center font-bold text-slate-700">Back</Link>
            <button type="submit" disabled={submitting || !acceptedLegal} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60">{submitting ? "Creating account…" : "Next"}</button>
          </div>
        </form>
        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">Already have an account? Sign in</Link>
      </div>
    </main>
  );
}
