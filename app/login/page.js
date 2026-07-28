"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { normalizeBusinessIdentifier } from "../lib/valueUtils";

function EyeIcon({ hidden }) {
  return hidden
    ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 8 9 8a17.5 17.5 0 0 1-2.1 3.3" /><path d="M6.6 6.6C4.4 8.1 3 12 3 12s3.5 8 9 8a9.8 9.8 0 0 0 4-.8" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12s3.5-8 9-8 9 8 9 8-3.5 8-9 8-9-8-9-8Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [loginMode, setLoginMode] = useState("owner");
  const [businessName, setBusinessName] = useState("");
  const [personName, setPersonName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(businessName, password, { loginMode, personName });
      router.replace("/");
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <h1 className="text-3xl font-bold text-slate-950">Welcome to ARK Client Center</h1>

        <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          {[["owner", "Owner"], ["employee", "Employee"]].map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setLoginMode(value); setError(""); }} className={loginMode === value ? "rounded-lg bg-white px-3 py-2.5 text-sm font-black text-slate-950 shadow-sm" : "rounded-lg px-3 py-2.5 text-sm font-bold text-slate-500"}>
              {label} Sign In
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Business name</span>
            <input required autoComplete="organization" value={businessName} onChange={(event) => setBusinessName(normalizeBusinessIdentifier(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" placeholder="Your business name" />
          </label>

          {loginMode === "employee" && (
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Employee name</span>
              <input required autoComplete="name" value={personName} onChange={(event) => setPersonName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950" placeholder="Your employee name" />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Password</span>
            <div className="relative mt-2">
              <input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-12 outline-none focus:border-slate-950" placeholder="Your password" />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950">
                <EyeIcon hidden={showPassword} />
              </button>
            </div>
          </label>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button type="submit" disabled={submitting} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in…" : `Sign in as ${loginMode === "employee" ? "Employee" : "Owner"}`}</button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <Link href="/forgot-password" className="font-semibold text-slate-600 hover:text-slate-950">Forgot password?</Link>
          <Link href="/signup" className="font-bold text-slate-950 hover:underline">Make an account</Link>
        </div>
      </div>
    </main>
  );
}
