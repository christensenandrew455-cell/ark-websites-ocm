"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import { useAuth } from "../components/AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";

function Progress({ value, maximum }) {
  const percent = maximum > 0 ? Math.min(100, Math.max(0, value / maximum * 100)) : 0;
  return <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Monthly rewarded referrals" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={Math.min(value, maximum)}><div className="h-full rounded-full bg-violet-600" style={{ width: `${percent}%` }} /></div>;
}

export default function RewardsPage() {
  const { user, loading } = useAuth();
  const [rewards, setRewards] = useState(null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken(true).then((token) => fetch("/api/rewards", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Rewards could not be loaded.");
      if (active) setRewards(data);
    }).catch((loadError) => active && setError(ownerFacingError(loadError))).finally(() => null);
    return () => { active = false; };
  }, [user]);

  async function copy(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Could not copy automatically. Press and hold the code to copy it.");
    }
  }

  if (loading || (!rewards && !error)) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading rewards…</main>;
  const referralLink = rewards ? `https://www.arkclientcenter.com/signup?ref=${encodeURIComponent(rewards.referralCode)}` : "";
  const rewarded = Number(rewards?.rewardedReferralsThisMonth || 0);
  const maximum = Number(rewards?.referralRewardsPerMonth || 3);

  return <main className="min-h-screen bg-transparent px-3 py-4 text-slate-950 sm:p-6 md:p-8">
    <div className="mx-auto max-w-4xl">
      <BackButton href="/" label="Back to Dashboard" />
      <header className="mt-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">ARK Client Center</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Rewards</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Share honest feedback, refer other businesses, and keep free lead credits ready for when you need them.</p>
      </header>
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{error}</p>}
      {rewards && <div className="mt-5 grid gap-4">
        <section className="rounded-3xl bg-violet-800 p-6 text-white shadow-sm sm:p-8">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Banked free lead credits</p>
          <p className="mt-2 text-5xl font-black">{Number(rewards.rewardLeadCreditBalance || 0).toLocaleString("en-US")}</p>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-violet-100">Credits stay in your Rewards balance. Once your included monthly leads are used up, apply them in Plan &amp; Payment in groups of five.</p>
          <Link href="/settings?section=payment&manage=topup" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-black text-violet-900">Open lead options</Link>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-100 text-xl" aria-hidden="true">★</div>
            <h2 className="mt-4 text-xl font-black">Give feedback</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Tell us what is working and what needs work. Send feedback anytime.</p>
            {!rewards.feedbackRewardEarned && <p className="mt-3 rounded-xl bg-violet-50 p-3 text-xs font-bold leading-5 text-violet-900">Your first thoughtful feedback may unlock a mystery thank-you.</p>}
            {rewards.feedbackRewardEarned && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">First-feedback thank-you unlocked.</p>}
            <Link href="/feedback" className="mt-4 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Give feedback</Link>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-xl" aria-hidden="true">↗</div>
            <h2 className="mt-4 text-xl font-black">Refer businesses</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Share as many referrals as you want. Each of your first three completed paid referrals per calendar month adds five free lead credits.</p>
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-slate-700">{rewarded} of {maximum} rewarded this month</p><p className="text-xs font-black text-violet-700">+5 each</p></div>
              <Progress value={rewarded} maximum={maximum} />
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-black">Your referral details</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Your business username is also your referral code. A referral counts after the new business finishes signup and payment.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Referral code / username</p><p className="mt-1 break-all text-sm font-black text-slate-950">{rewards.referralCode}</p></div>
            <button type="button" onClick={() => copy("code", rewards.referralCode)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black">{copied === "code" ? "Copied" : "Copy code"}</button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Referral link</p><p className="mt-1 truncate text-sm font-bold text-slate-700">{referralLink}</p></div>
            <button type="button" onClick={() => copy("link", referralLink)} className="rounded-xl bg-blue-800 px-5 py-3 text-sm font-black text-white">{copied === "link" ? "Copied" : "Copy link"}</button>
          </div>
        </section>
      </div>}
    </div>
  </main>;
}
