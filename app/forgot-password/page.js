"use client";

import Link from "next/link";
import { useState } from "react";
import { readApiJson } from "../lib/apiResponse";
import { publicFormError } from "../lib/userFacingError";

export default function ForgotPasswordPage() {
  const [businessName, setBusinessName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: businessName }),
      });
      await readApiJson(response, "Unable to send the reset email.");
      setMessage("If that business account exists, a password reset email has been sent to its business email.");
    } catch (resetError) {
      setError(publicFormError(resetError, "Unable to send the reset email right now."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl md:p-9">
        <h1 className="text-3xl font-bold">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-600">Enter the business name or account email.</p>
        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <input
            required
            autoComplete="username"
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
            placeholder="Business name or email"
          />
          {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</p>}
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button disabled={submitting} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60">
            {submitting ? "Sending…" : "Send reset email"}
          </button>
        </form>
        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-950">
          Back to login
        </Link>
      </div>
    </main>
  );
}
