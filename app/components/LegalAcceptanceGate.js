"use client";

import Link from "next/link";
import { useState } from "react";
import { PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { useAuth } from "./AuthProvider";

export default function LegalAcceptanceGate() {
  const { user, profile, refreshProfile, logout } = useAuth();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCurrent = Boolean(
    profile?.termsAccepted === true
    && profile?.privacyAccepted === true
    && profile?.termsVersion === TERMS_VERSION
    && profile?.privacyVersion === PRIVACY_VERSION
  );

  if (!user || profile?.role === "admin" || isCurrent) return null;

  async function acceptPolicies(event) {
    event.preventDefault();
    if (!acceptedTerms || !acceptedPrivacy || saving) return;

    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/legal/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The policy acceptance could not be saved.");
      await refreshProfile();
    } catch (acceptanceError) {
      console.error(acceptanceError);
      setError(acceptanceError.message || "The policy acceptance could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-sm">
      <section className="mx-auto my-4 w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl sm:my-10 sm:p-8">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Required before continuing</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Review the current policies</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The Terms of Use or Privacy Policy has not been accepted for this account, or a newer version is available. You must accept both current policies before using the app.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link href="/terms" className="rounded-xl border border-slate-300 px-3 py-3 text-center text-xs font-black text-slate-800 hover:bg-slate-50 sm:text-sm">
            Read Terms of Use
          </Link>
          <Link href="/privacy" className="rounded-xl border border-slate-300 px-3 py-3 text-center text-xs font-black text-slate-800 hover:bg-slate-50 sm:text-sm">
            Read Privacy Policy
          </Link>
        </div>

        <form onSubmit={acceptPolicies} className="mt-5 space-y-3">
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-slate-950"
            />
            <span className="text-sm font-semibold leading-6 text-slate-700">
              I have read and agree to the current Terms of Use, version {TERMS_VERSION}.
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={acceptedPrivacy}
              onChange={(event) => setAcceptedPrivacy(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-slate-950"
            />
            <span className="text-sm font-semibold leading-6 text-slate-700">
              I have read and agree to the current Privacy Policy, version {PRIVACY_VERSION}.
            </span>
          </label>

          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={!acceptedTerms || !acceptedPrivacy || saving}
            className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"
          >
            {saving ? "Saving acceptance…" : "Accept and Continue"}
          </button>
        </form>

        <button type="button" onClick={logout} className="mt-3 w-full rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">
          Sign out instead
        </button>
      </section>
    </div>
  );
}
