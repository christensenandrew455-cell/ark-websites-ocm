"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../components/AuthProvider";
import PasswordInput from "../components/PasswordInput";
import { normalizeBusinessIdentifier } from "../lib/valueUtils";
import { publicFormError } from "../lib/userFacingError";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(businessName, password);
      router.replace("/");
    } catch (loginError) {
      setError(publicFormError(loginError, "Unable to sign in right now."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="ark-auth-page grid min-h-screen place-items-center p-5">
      <div className="ark-auth-card w-full max-w-md rounded-3xl p-7 shadow-2xl md:p-9">
        <h1 className="text-3xl font-bold text-slate-950">Welcome to ARK Client Center</h1>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block"><span className="text-sm font-semibold text-slate-700">Business name</span><input required autoComplete="organization" value={businessName} onChange={(event) => setBusinessName(normalizeBusinessIdentifier(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" placeholder="Your business name" /></label>
          <label className="block"><span className="text-sm font-semibold text-slate-700">Password</span><PasswordInput required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" placeholder="Your password" /></label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button type="submit" disabled={submitting} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="mt-5 flex items-center justify-between gap-3 text-sm"><Link href="/forgot-password" className="font-semibold text-slate-600 hover:text-slate-950">Forgot password?</Link><Link href="/signup" className="font-bold text-slate-950 hover:underline">Make an account</Link></div>
      </div>
    </main>
  );
}
