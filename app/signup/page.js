"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";

function normalizeBusinessName(value) {
  return String(value || "").replace(/\s+/g, "-");
}

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    businessName: "",
    ownerName: "",
    accountEmail: "",
    accountPhone: "",
    password: "",
    confirmPassword: "",
  });
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(event) {
    const value = event.target.name === "businessName" ? normalizeBusinessName(event.target.value) : event.target.value;
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

  return (
    <main className="min-h-screen bg-slate-950 p-5 py-10">
      <div className="mx-auto w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK OCM</p>
        <h1 className="mt-3 text-3xl font-bold">Make an account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Enter the business information and choose a password. ARK will verify the account before payment setup is available.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
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

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <input required type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-slate-950" />
            <span className="text-sm leading-6 text-slate-700">
              I have read and agree to the <Link href="/terms" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" rel="noreferrer" className="font-black text-slate-950 underline">Privacy Policy</Link>, including ongoing recurring billing after account approval and payment setup.
            </span>
          </label>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}

          <button disabled={submitting || !acceptedLegal} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">
            {submitting ? "Submitting for verification…" : "Submit for verification"}
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
