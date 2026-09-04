"use client";

import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import InfoTip from "../components/InfoTip";
import { useAuth } from "../components/AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function money(value) {
  return USD.format(Number(value || 0) / 100);
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
      if (!response.ok) throw new Error(data.error || "Referral information could not be loaded.");
      if (active) setRewards(data);
    }).catch((loadError) => active && setError(ownerFacingError(loadError)));
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

  if (loading || (!rewards && !error)) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading…</main>;
  const referralLink = rewards ? `https://www.arkclientcenter.com/signup?ref=${encodeURIComponent(rewards.referralCode)}` : "";
  const earned = Number(rewards?.referralFreeMonthsEarned || 0);
  const pending = Number(rewards?.referralFreeMonthsPending || 0);

  return <main className="min-h-screen bg-transparent px-3 py-4 text-slate-950 sm:p-6 md:p-8">
    <div className="mx-auto max-w-3xl">
      <BackButton href="/" />
      <header className="mt-5">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Refer &amp; Save</h1>
      </header>
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{error}</p>}
      {rewards && !rewards.referralRewardAvailable && <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-black">Coming to Apple billing later</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Refer &amp; Save is available to Stripe-billed accounts on the website and Android. Apple requires a separate in-app offer.</p>
      </section>}
      {rewards?.referralRewardAvailable && <div className="mt-5 space-y-4">
        <section className="rounded-3xl bg-[#071a3d] p-6 text-white shadow-sm sm:p-8">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black">Refer one business</h2>
            <InfoTip label="How Refer & Save works">When a business uses your code and finishes paid signup, ARK credits the recurring price of your plan at that time. The credit starts with your next Stripe bill. Each business can qualify once. Self-referrals and duplicate accounts do not count.</InfoTip>
          </div>
          <p className="mt-2 text-4xl font-black">Get one month free.</p>
          <p className="mt-3 text-sm font-bold text-blue-100">Your {rewards.referralPlanName} plan · {money(rewards.referralPlanAmountCents)}</p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Your code</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 break-all text-2xl font-black text-slate-950">{rewards.referralCode}</p>
            <button type="button" onClick={() => copy("code", rewards.referralCode)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-black">{copied === "code" ? "Copied" : "Copy code"}</button>
          </div>
          <button type="button" onClick={() => copy("link", referralLink)} className="mt-5 w-full rounded-xl bg-[#071a3d] px-5 py-3 text-sm font-black text-white sm:w-auto">{copied === "link" ? "Link copied" : "Copy invite link"}</button>
          {earned > 0 && <p className="mt-4 border-t border-slate-200 pt-4 text-sm font-bold text-slate-700">Free months earned: {earned}{pending > 0 ? ` · ${pending} processing` : ""}</p>}
        </section>
      </div>}
    </div>
  </main>;
}
