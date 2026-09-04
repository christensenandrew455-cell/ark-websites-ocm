"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

const TUTORIAL_STATUSES = new Set(["pending", "started"]);
const GUIDE_VERSION = 3;

const TUTORIAL_ITEMS = Object.freeze([
  {
    title: "New Leads",
    body: "Tap to see new requests and any current clients you’ve accepted.",
  },
  {
    title: "Business Information",
    body: "Go to Settings → Business information to edit or add your business details.",
  },
  {
    title: "Plan and payment",
    body: "Go to Settings → Plan and payment to change your plan or payment method.",
  },
  {
    title: "Customization",
    body: "Go to Settings → Customization to change the app’s look and preferences.",
  },
]);

const REFERRAL_ITEM = Object.freeze({
  title: "Refer & Save",
  body: "Tap Refer & Save during your first 24 hours to share your code. When one business uses it and finishes paid signup, you get one month free on your current plan.",
});

export default function QuickTutorial() {
  const pathname = usePathname();
  const { user, profile, updateProfile } = useAuth();
  const tutorialRef = useRef(null);
  const [dismissed, setDismissed] = useState(false);
  const visible = !dismissed
    && pathname === "/"
    && Boolean(user)
    && profile?.identityVerificationVerified === true
    && profile?.onboardingTourEligible === true
    && TUTORIAL_STATUSES.has(String(profile?.onboardingTourStatus || "").toLowerCase());
  const items = profile?.referralRewardAvailable === true ? [...TUTORIAL_ITEMS, REFERRAL_ITEM] : TUTORIAL_ITEMS;

  useEffect(() => {
    if (!visible) return undefined;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    tutorialRef.current?.focus({ preventScroll: true });
    return () => { document.documentElement.style.overflow = previousOverflow; };
  }, [visible]);

  async function dismiss() {
    if (!user) return;
    setDismissed(true);
    updateProfile({ onboardingTourStatus: "completed", onboardingGuideVersion: GUIDE_VERSION });

    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/onboarding-tour", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guide: "quick-tutorial" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the tutorial progress.");
      updateProfile({
        onboardingTourStatus: String(data.onboardingTourStatus || "completed"),
        onboardingGuideVersion: Number(data.onboardingGuideVersion || GUIDE_VERSION),
      });
    } catch (error) {
      console.warn("Unable to save Quick Tutorial progress", error);
    }
  }

  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-[2px]"
      style={{
        paddingTop: "max(1rem, var(--ark-safe-area-top))",
        paddingRight: "max(1rem, var(--ark-safe-area-right))",
        paddingBottom: "max(1rem, var(--ark-safe-area-bottom))",
        paddingLeft: "max(1rem, var(--ark-safe-area-left))",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-tutorial-title"
      aria-describedby="quick-tutorial-intro"
    >
      <section ref={tutorialRef} tabIndex={-1} className="max-h-full w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 text-slate-950 shadow-2xl outline-none sm:p-7">
        <h2 id="quick-tutorial-title" className="text-2xl font-black tracking-tight">Quick Tutorial</h2>
        <p id="quick-tutorial-intro" className="mt-2 text-sm font-semibold leading-6 text-slate-600">Here are the main places to start.</p>
        <ol className="mt-5 space-y-3">
          {items.map((item, index) => (
            <li key={item.title} className="flex gap-3 rounded-2xl bg-slate-100 px-4 py-3">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#071a3d] text-xs font-black text-white">{index + 1}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-slate-950">{item.title}</h3>
                <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-600">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" onClick={dismiss} className="mt-5 w-full rounded-xl bg-[#071a3d] px-5 py-3 text-sm font-black text-white shadow-sm transition active:scale-[0.99]">Got it</button>
      </section>
    </div>
  );
}
