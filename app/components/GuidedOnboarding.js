"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL } from "../lib/launchFeatures";

const STEPS = [
  { path: "/", target: "settings", title: "Settings", body: "Business, preferences, payment, and help.", action: "activate", actionLabel: "Open Settings" },
  { path: "/settings", target: "settings-business", title: "Business Information", body: "What your receptionist knows.", action: "next", actionLabel: "Next" },
  { path: "/settings", target: "settings-customization", title: "Customization", body: "Appearance and preferences.", action: "next", actionLabel: "Next" },
  { path: "/settings", target: "settings-menu-back", title: "Dashboard", body: "Back to your main screen.", action: "activate", actionLabel: "Open Dashboard" },
  { path: "/", target: "dashboard-leads", title: "Leads", body: "New leads and clients.", action: "next", actionLabel: "Next" },
  { path: "/", target: "dashboard-messages", title: "Messages", body: MESSAGES_AVAILABLE ? "Client texts." : UPCOMING_FEATURE_LABEL, action: "next", actionLabel: "Next" },
  { path: "/", target: "referral-star", title: "Referral Savings", body: "Your account ID and savings.", action: "activate", actionLabel: "Finish", finishAfter: true },
];

function targetElement(id) {
  return document.querySelector(`[data-tour-id="${id}"]`);
}

function bounded(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export default function GuidedOnboarding() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const panelRef = useRef(null);
  const startedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const [panelStyle, setPanelStyle] = useState({ left: 12, right: 12, bottom: "max(12px, env(safe-area-inset-bottom))" });
  const current = STEPS[step];

  useEffect(() => {
    const eligible = profile?.identityVerificationVerified === true
      && profile?.onboardingTourEligible === true
      && ["pending", "started"].includes(profile?.onboardingTourStatus);
    if (!eligible || !user || startedRef.current) return;
    startedRef.current = true;
    setOpen(true);
    user.getIdToken(true).then((token) => fetch("/api/account/onboarding-tour", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "started" }),
    })).catch((error) => console.warn("Unable to save guided tour start", error));
  }, [profile?.clientId, profile?.identityVerificationVerified, profile?.onboardingTourEligible, profile?.onboardingTourStatus, user]);

  const measure = useCallback(() => {
    if (!open || !current || pathname !== current.path) {
      setRect(null);
      return;
    }
    const target = targetElement(current.target);
    if (!target) {
      setRect(null);
      return;
    }

    const bounds = target.getBoundingClientRect();
    const padding = 10;
    const gap = 14;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const top = bounded(bounds.top - 6, padding, viewportHeight - padding);
    const left = bounded(bounds.left - 6, padding, viewportWidth - padding);
    const right = bounded(bounds.right + 6, padding, viewportWidth - padding);
    const bottom = bounded(bounds.bottom + 6, padding, viewportHeight - padding);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const panelWidth = Math.min(420, viewportWidth - padding * 2);
    const panelHeight = panelRef.current?.offsetHeight || 230;
    const centeredLeft = bounds.left + bounds.width / 2 - panelWidth / 2;
    const cardLeft = bounded(centeredLeft, padding, viewportWidth - panelWidth - padding);
    const below = bottom + gap;
    const above = top - panelHeight - gap;
    const preferredTop = below + panelHeight <= viewportHeight - padding ? below : above;
    const cardTop = bounded(preferredTop, padding, viewportHeight - panelHeight - padding);

    setRect({ top, left, width, height });
    setPanelStyle({ top: cardTop, left: cardLeft, width: panelWidth });
  }, [current, open, pathname]);

  useLayoutEffect(() => {
    if (!open || !current) return undefined;
    if (pathname !== current.path) {
      setRect(null);
      router.replace(current.path);
      return undefined;
    }

    let attempts = 0;
    const locate = () => {
      const target = targetElement(current.target);
      if (!target) {
        attempts += 1;
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      target.scrollIntoView({ block: "center", behavior: "auto" });
      window.requestAnimationFrame(measure);
      window.clearInterval(timer);
    };
    const timer = window.setInterval(locate, 100);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    locate();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current, measure, open, pathname, router]);

  async function finish(status) {
    setOpen(false);
    try {
      const token = await user.getIdToken(true);
      await fetch("/api/account/onboarding-tour", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      await refreshProfile();
    } catch (error) {
      console.warn("Unable to save guided tour status", error);
    }
  }

  function next() {
    if (step >= STEPS.length - 1) finish("completed");
    else setStep((value) => value + 1);
  }

  function runAction() {
    if (!rect) return;
    if (current.action === "activate") targetElement(current.target)?.click();
    if (current.finishAfter) window.setTimeout(() => finish("completed"), 250);
    else window.setTimeout(next, current.action === "activate" ? 160 : 0);
  }

  if (!open || !current) return null;
  const edge = rect || { top: 0, left: 0, width: 0, height: 0 };
  return <div className="fixed inset-0 z-[230]" role="dialog" aria-modal="true" aria-label="ARK Client Center guided tour">
    {rect ? <>
      <div className="fixed inset-x-0 top-0 bg-slate-950/80 backdrop-grayscale" style={{ height: edge.top }} />
      <div className="fixed left-0 bg-slate-950/80 backdrop-grayscale" style={{ top: edge.top, width: edge.left, height: edge.height }} />
      <div className="fixed right-0 bg-slate-950/80 backdrop-grayscale" style={{ top: edge.top, left: edge.left + edge.width, height: edge.height }} />
      <div className="fixed inset-x-0 bottom-0 bg-slate-950/80 backdrop-grayscale" style={{ top: edge.top + edge.height }} />
      <button type="button" onClick={runAction} aria-label={`${current.actionLabel}: ${current.title}`} className="fixed z-[231] rounded-2xl border-4 border-yellow-300 bg-yellow-300/10 shadow-[0_0_0_4px_rgba(250,204,21,0.3),0_0_30px_rgba(250,204,21,0.75)]" style={edge} />
    </> : <div className="fixed inset-0 bg-slate-950/80 backdrop-grayscale" />}
    <section ref={panelRef} style={panelStyle} className="fixed z-[232] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 text-slate-950 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">Quick tour</p><p className="text-xs font-black text-slate-400">{step + 1} of {STEPS.length}</p></div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">{STEPS.map((item, index) => <span key={`${item.target}-${index}`} className={index <= step ? "h-1.5 flex-1 rounded-full bg-indigo-700" : "h-1.5 flex-1 rounded-full bg-slate-200"} />)}</div>
      <h2 className="mt-4 text-xl font-black tracking-tight">{current.title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{current.body}</p>
      <p className="mt-3 text-xs font-bold text-yellow-700">Tap the highlighted item.</p>
      <div className="mt-5 grid grid-cols-[auto_1fr] gap-2"><button type="button" onClick={() => finish("skipped")} className="rounded-xl px-3 py-3 text-xs font-black text-slate-500">Skip</button><button type="button" disabled={!rect} onClick={runAction} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black text-white disabled:bg-slate-300">{rect ? current.actionLabel : "Finding this item…"}</button></div>
    </section>
  </div>;
}
