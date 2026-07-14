"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const PENDING_SIGNUP_KEY = "ark-ocm-pending-signup";

export default function SignupPage() {
  const [form, setForm] = useState({
    businessName: "",
    ownerName: "",
    accountEmail: "",
    accountPhone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") {
      setNotice("Card setup was canceled. Your account was not created, and you can try again when ready.");
    }
  }, []);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (form.password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName,
          ownerName: form.ownerName,
          accountEmail: form.accountEmail,
          accountPhone: form.accountPhone,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to start secure payment setup.");
      }

      sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ ...form, confirmPassword: undefined }));
      window.location.assign(data.url);
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
        <p className="mt-2 text-sm text-slate-600">
          Enter the business information, choose a password, and then add a payment method through Stripe.
        </p>

        {notice && <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{notice}</p>}

        <form onSubmit={handleSubmit} className="mt-7 grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Business name</span>
            <input required name="businessName" autoComplete="organization" value={form.businessName} onChange={updateField} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" />
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

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}

          <button disabled={submitting} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">
            {submitting ? "Opening Stripe…" : "Continue to secure payment setup"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          The account becomes active only after Stripe confirms the payment method. Card details stay inside Stripe.
        </p>
        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">
          Already have an account? Log in
        </Link>
      </div>
    </main>
  );
}
