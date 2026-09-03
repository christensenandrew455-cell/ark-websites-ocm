"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

const PAGE_GUIDES = Object.freeze({
  dashboard: {
    eyebrow: "Welcome",
    title: "Welcome to your ARK Client Center",
    body: "This is your dashboard. It gives you a quick look at new leads and the main parts of your client center.",
    points: [
      "Open “Leads” to review people under “Contacted You” and “Clients.”",
      "Open “Settings” to update your business information, preferences, and payment method.",
      "Tap around and explore. The first time you open a main section, we’ll quickly explain what is inside.",
    ],
  },
  settings: {
    eyebrow: "Settings",
    title: "This is Settings",
    body: "Settings is where you control your business, your AI receptionist, your app, and your account.",
    points: [
      "Use “Business Information” to update regular scheduling, optional Emergency / ASAP service, services, and service area.",
      "Customize the app and your client preferences.",
      "Review your monthly accepted-lead plan, accepted leads remaining, and payment method.",
      "Use “Docs,” “AI Chat,” or “Support,” download your client data, or delete your account.",
    ],
  },
  leads: {
    eyebrow: "Leads",
    title: "This is your Leads page",
    body: "Everything your AI receptionist collects is organized here.",
    points: [
      "“Contacted You” holds new leads. Choose “Accept” to move one to “Clients,” or choose “Decline” to remove it.",
      "“Clients” holds accepted customers. Open one to edit details and notes, save the contact, or add the appointment to your calendar.",
      "Delete a client you no longer need from its client details.",
      "Your plan, remaining monthly accepted leads, and payment method are under “Settings,” then “Payment.”",
    ],
  },
});

function pageGuide(pathname) {
  if (pathname === "/") return "dashboard";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  if (pathname === "/leads" || pathname.startsWith("/leads/")) return "leads";
  return "";
}

function guideSeen(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    dashboard: source.dashboard === true,
    settings: source.settings === true,
    leads: source.leads === true,
  };
}

function normalizedPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function displayPhone(value) {
  const digits = normalizedPhone(value).replace(/^\+1/, "");
  if (digits.length !== 10) return String(value || "").trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function assignedNumberGuide(phone) {
  return {
    id: "number-assigned",
    eyebrow: "Your number is ready",
    title: "Great—you’ve been assigned a number",
    body: `Your ARK AI receptionist number is ${displayPhone(phone)}.`,
    points: [
      "Replace the phone number anywhere you advertise your business with this one.",
      "Calls to this number will go through your AI receptionist so you can reap the benefits of the app.",
    ],
    phone,
  };
}

export default function FirstVisitGuides() {
  const pathname = usePathname();
  const { user, profile, updateProfile } = useAuth();
  const [activeGuide, setActiveGuide] = useState(null);
  const shownKeys = useRef(new Set());
  const dismissedPath = useRef("");

  const candidate = useMemo(() => {
    if (!user || !profile || profile.identityVerificationVerified !== true || profile.onboardingTourEligible !== true) return null;

    const currentPage = pageGuide(pathname);
    const seen = guideSeen(profile.onboardingGuideSeen);
    const legacyStatus = String(profile.onboardingTourStatus || "").trim().toLowerCase();
    const pageGuidesAvailable = ["pending", "started"].includes(legacyStatus);
    if (currentPage && pageGuidesAvailable && !seen[currentPage]) {
      return { id: currentPage, ...PAGE_GUIDES[currentPage] };
    }

    if (pathname !== "/" || Number(profile.onboardingGuideVersion || 0) < 2) return null;
    const assignedPhone = normalizedPhone(profile.receptionistPhoneNormalized || profile.receptionistPhone);
    const acknowledgedPhone = normalizedPhone(profile.onboardingNumberGuidePhone);
    if (profile.numberAssignmentStatus === "assigned" && assignedPhone && assignedPhone !== acknowledgedPhone) {
      return assignedNumberGuide(assignedPhone);
    }
    return null;
  }, [pathname, profile, user]);

  useEffect(() => {
    if (activeGuide || !candidate || dismissedPath.current === pathname) return;
    const key = `${profile?.clientId || "account"}:${candidate.id}:${candidate.phone || ""}`;
    if (shownKeys.current.has(key)) return;
    shownKeys.current.add(key);
    setActiveGuide(candidate);
  }, [activeGuide, candidate, pathname, profile?.clientId]);

  useEffect(() => {
    if (!activeGuide) return undefined;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previousOverflow; };
  }, [activeGuide]);

  async function dismiss() {
    if (!activeGuide || !user) return;
    const dismissed = activeGuide;
    dismissedPath.current = pathname;
    setActiveGuide(null);

    const previousSeen = guideSeen(profile?.onboardingGuideSeen);
    if (dismissed.id === "number-assigned") {
      updateProfile({
        onboardingGuideVersion: 2,
        onboardingNumberGuidePhone: dismissed.phone,
      });
    } else {
      const nextSeen = { ...previousSeen, [dismissed.id]: true };
      updateProfile({
        onboardingGuideVersion: 2,
        onboardingGuideSeen: nextSeen,
        onboardingTourStatus: Object.values(nextSeen).every(Boolean) ? "completed" : "started",
      });
    }

    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/onboarding-tour", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guide: dismissed.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the guide progress.");
      updateProfile({
        onboardingGuideVersion: Number(data.onboardingGuideVersion || 2),
        onboardingGuideSeen: guideSeen(data.onboardingGuideSeen),
        onboardingNumberGuidePhone: String(data.onboardingNumberGuidePhone || dismissed.phone || ""),
        onboardingTourStatus: String(data.onboardingTourStatus || profile?.onboardingTourStatus || ""),
      });
    } catch (error) {
      console.warn("Unable to save first-visit guide progress", error);
    }
  }

  if (!activeGuide) return null;
  const descriptionId = `first-visit-guide-${activeGuide.id}`;
  return (
    <div className="fixed inset-0 z-[230]" role="dialog" aria-modal="true" aria-labelledby={`${descriptionId}-title`} aria-describedby={`${descriptionId}-body`}>
      <button type="button" onClick={dismiss} aria-label="Continue exploring ARK Client Center" className="fixed inset-0 cursor-default bg-slate-950/75 backdrop-blur-[2px]" />
      <section className="pointer-events-none fixed inset-x-4 top-1/2 z-[231] mx-auto max-h-[calc(100dvh-32px)] max-w-md -translate-y-1/2 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 text-slate-950 shadow-2xl sm:p-7">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">{activeGuide.eyebrow}</p>
        <h2 id={`${descriptionId}-title`} className="mt-3 text-2xl font-black tracking-tight">{activeGuide.title}</h2>
        <p id={`${descriptionId}-body`} className="mt-3 text-sm font-semibold leading-6 text-slate-600">{activeGuide.body}</p>
        <ul className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-700">
          {activeGuide.points.map((point) => <li key={point} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-700" /><span>{point}</span></li>)}
        </ul>
        <p className="mt-6 border-t border-slate-200 pt-4 text-center text-xs font-black uppercase tracking-[0.14em] text-indigo-700">Tap anywhere to continue</p>
      </section>
    </div>
  );
}
