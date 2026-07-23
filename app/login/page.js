"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../components/AuthProvider";

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
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") ? next : "/");
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">ARK Websites</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-950">Welcome to ARK OCM</h1>
        <p className="mt-2 text-sm text-slate-600">Log in with your business name and password.</p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Business name</span>
            <input
              required
              autoComplete="organization"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
              placeholder="Business name"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Password</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
              placeholder="Your password"
            />
          </label>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Log in"}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <Link href="/forgot-password" className="font-semibold text-slate-600 hover:text-slate-950">
            Forgot password?
          </Link>
          <Link href="/signup" className="font-bold text-slate-950 hover:underline">
            Make an account
          </Link>
        </div>
        <p className="mt-5 text-center text-xs text-slate-400">Admin accounts may use their account email in the business-name field.</p>
      </div>
    </main>
  );
}
