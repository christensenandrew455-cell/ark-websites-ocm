"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import InfoTip from "../components/InfoTip";
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
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Free leads</h1>
      </header>
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{error}</p>}
      {rewards && <div className="mt-5 space-y-4">
        <section className="rounded-3xl bg-violet-800 p-6 text-white shadow-sm sm:p-8">
          <div className="flex items-center gap-2"><h2 className="text-sm font-black text-violet-100">Free leads</h2><InfoTip label="About free leads">These stay in Rewards until your monthly plan reaches zero. Then you can use five at a time.</InfoTip></div>
          <p className="mt-2 text-5xl font-black">{Number(rewards.rewardLeadCreditBalance || 0).toLocaleString("en-US")}</p>
          <Link href="/settings?section=payment&manage=topup" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-black text-violet-900">Use leads</Link>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><h2 className="text-xl font-black">Invite a business</h2><InfoTip label="Referral reward">You get five free leads after a business signs up and pays with your link or code. Up to three referrals earn rewards each month.</InfoTip></div>
              <p className="mt-1 text-sm font-bold text-slate-600">5 free leads each · {rewarded}/{maximum} this month</p>
            </div>
          </div>
          <Progress value={rewarded} maximum={maximum} />
          <button type="button" onClick={() => copy("link", referralLink)} className="mt-5 w-full rounded-xl bg-blue-800 px-5 py-3 text-sm font-black text-white sm:w-auto">{copied === "link" ? "Link copied" : "Copy invite link"}</button>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
            <p className="min-w-0 flex-1 break-all text-sm font-bold text-slate-600">Code: <span className="text-slate-950">{rewards.referralCode}</span></p>
            <button type="button" onClick={() => copy("code", rewards.referralCode)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-black">{copied === "code" ? "Copied" : "Copy code"}</button>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-xl font-black">Give feedback</h2>{!rewards.feedbackRewardEarned && <InfoTip label="Feedback thank-you">Your first useful feedback may earn free leads. Positive or negative both count.</InfoTip>}</div>
            <p className="mt-1 text-sm font-semibold text-slate-600">Share a problem or idea.</p>
          </div>
          <Link href="/feedback" className="inline-flex justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{rewards.feedbackRewardEarned ? "Send feedback" : "Give feedback"}</Link>
        </section>
      </div>}
    </div>
  </main>;
}
