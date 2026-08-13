"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { EMPLOYEES_AVAILABLE, MESSAGES_AVAILABLE } from "../lib/launchFeatures";

const TOUR_PENDING_KEY = "ark-guided-onboarding-pending-v1";
const STEPS = [
  { path: "/", target: "settings", title: "Start with Settings", body: "Settings is where you manage business information, customization, payment, help, and the account.", activate: true },
  { path: "/settings", target: "settings-business", title: "Business Information", body: "This is the information your AI receptionist uses to answer callers. Tap it to look inside.", activate: true },
  { path: "/settings", target: "settings-section-back", title: "Your receptionist knowledge", body: "Update services, service areas, estimate availability, and other business facts here. Tap the highlighted back arrow when you are ready.", activate: true },
  { path: "/settings", target: "settings-customization", title: "Customization", body: "Customization contains app appearance and account data options. Tap it to look inside.", activate: true },
  { path: "/settings", target: "settings-section-back", title: "Your app preferences", body: "Choose the app appearance and download your client data here. Tap back when you are ready.", activate: true },
  { path: "/settings", target: "settings-menu-back", title: "Back to the dashboard", body: "The back arrow returns to your main dashboard. Tap it now.", activate: true },
  { path: "/", target: "dashboard-leads", title: "Leads", body: "Open Leads to review new receptionist requests and the clients you accepted." },
  ...(MESSAGES_AVAILABLE ? [{ path: "/", target: "dashboard-messages", title: "Messages", body: "Messages lets you text clients when that feature is turned on in Customization." }] : []),
  ...(EMPLOYEES_AVAILABLE ? [{ path: "/", target: "dashboard-employees", title: "Employees", body: "Employees lets you approve and manage workers when that feature is turned on." }] : []),
  { path: "/", target: "referral-star", title: "Featured referral savings", body: "Tap the star to see your account ID and referral savings. This finishes the tour.", activate: true, finishAfter: true },
];

function targetElement(id) { return document.querySelector(`[data-tour-id="${id}"]`); }

export default function GuidedOnboarding() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const current = STEPS[step];

  useEffect(() => {
    if (profile?.identityVerificationVerified !== true || profile?.onboardingTourStatus !== "pending") return;
    let pending = true;
    try { pending = window.localStorage.getItem(TOUR_PENDING_KEY) !== "false"; } catch {}
    setOpen(pending);
  }, [profile?.identityVerificationVerified, profile?.onboardingTourStatus]);

  const measure = useCallback(() => {
    if (!open || !current || pathname !== current.path) return setRect(null);
    const target = targetElement(current.target);
    if (!target) return setRect(null);
    const bounds = target.getBoundingClientRect();
    setRect({ top: Math.max(6, bounds.top - 6), left: Math.max(6, bounds.left - 6), width: Math.min(window.innerWidth - 12, bounds.width + 12), height: bounds.height + 12 });
  }, [current, open, pathname]);

  useLayoutEffect(() => {
    if (!open || !current) return undefined;
    if (pathname !== current.path) { router.replace(current.path); return undefined; }
    let attempts = 0;
    const timer = window.setInterval(() => {
      const target = targetElement(current.target);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: attempts ? "auto" : "smooth" });
        measure();
        window.clearInterval(timer);
      }
      attempts += 1;
      if (attempts > 30) window.clearInterval(timer);
    }, 100);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [current, measure, open, pathname, router]);

  async function finish(status) {
    setOpen(false);
    try { window.localStorage.setItem(TOUR_PENDING_KEY, "false"); } catch {}
    try {
      const token = await user.getIdToken(true);
      await fetch("/api/account/onboarding-tour", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ status }) });
      await refreshProfile();
    } catch {}
  }

  function next() {
    if (step >= STEPS.length - 1) finish("completed");
    else setStep((value) => value + 1);
  }

  function activate() {
    targetElement(current.target)?.click();
    if (current.finishAfter) window.setTimeout(() => finish("completed"), 350);
    else window.setTimeout(next, 120);
  }

  if (!open || !current) return null;
  const edge = rect || { top: 0, left: 0, width: 0, height: 0 };
  return <div className="fixed inset-0 z-[230]" role="dialog" aria-modal="true" aria-label="ARK Client Center guided tour">
    {rect ? <>
      <div className="fixed inset-x-0 top-0 bg-slate-950/75 backdrop-grayscale" style={{ height: edge.top }} />
      <div className="fixed left-0 bg-slate-950/75 backdrop-grayscale" style={{ top: edge.top, width: edge.left, height: edge.height }} />
      <div className="fixed right-0 bg-slate-950/75 backdrop-grayscale" style={{ top: edge.top, left: edge.left + edge.width, height: edge.height }} />
      <div className="fixed inset-x-0 bottom-0 bg-slate-950/75 backdrop-grayscale" style={{ top: edge.top + edge.height }} />
      <button type="button" onClick={current.activate ? activate : undefined} aria-label={current.activate ? `Open ${current.title}` : current.title} className="fixed rounded-2xl border-4 border-yellow-300 bg-yellow-300/10 shadow-[0_0_0_4px_rgba(250,204,21,0.3),0_0_35px_rgba(250,204,21,0.8)]" style={edge} />
    </> : <div className="fixed inset-0 bg-slate-950/75 backdrop-grayscale" />}
    <section className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto max-w-md rounded-2xl bg-white p-5 text-slate-950 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">Quick tour</p><p className="text-xs font-black text-slate-400">{step + 1} of {STEPS.length}</p></div>
      <h2 className="mt-2 text-xl font-black tracking-tight">{current.title}</h2>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{current.body}</p>
      <div className="mt-4 flex items-center justify-between gap-3"><button type="button" onClick={() => finish("skipped")} className="px-2 py-2 text-xs font-black text-slate-500">Skip Tour</button>{current.activate ? <p className="text-xs font-black text-yellow-700">Tap the yellow highlight</p> : <button type="button" onClick={next} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">Click to Continue</button>}</div>
    </section>
  </div>;
}
