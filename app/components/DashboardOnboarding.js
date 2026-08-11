"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_ONBOARDING_KEY } from "../lib/ownerSignup";

const STEPS = [
  {
    eyebrow: "Welcome to ARK",
    title: "This is your dashboard",
    body: "The dashboard is your starting point. It shows your receptionist number and the current counts for the workspaces that need your attention.",
    items: [
      ["Receptionist number", "Your assigned business number appears near the top."],
      ["Live counts", "Each workspace card shows how many items are waiting."],
    ],
  },
  {
    eyebrow: "Your workspaces",
    title: "Tap a card to open it",
    body: "The three large dashboard cards are the main places where you will work.",
    items: [
      ["Leads", "Open Contacted You, review every new request, and see accepted Clients."],
      ["Messages", "Text clients when Messages is turned on in Settings."],
      ["Employees", "Approve and manage employees when Employees is turned on."],
    ],
  },
  {
    eyebrow: "Navigation",
    title: "Settings and Help stay close",
    body: "Use the controls around the dashboard whenever you need to change the account or learn where something is.",
    items: [
      ["Settings gear", "Tap the gear in the upper-right corner for business information, customization, payment, and account controls."],
      ["Help", "Open Help for answers and support from anywhere in the owner workspace."],
      ["Sign out", "The Sign out button is always in the top header."],
    ],
  },
];

export default function DashboardOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try { setOpen(window.localStorage.getItem(DASHBOARD_ONBOARDING_KEY) === "pending"); }
    catch { setOpen(false); }
  }, []);

  function finish() {
    try { window.localStorage.setItem(DASHBOARD_ONBOARDING_KEY, "complete"); } catch {}
    setOpen(false);
  }

  if (!open) return null;
  const current = STEPS[step];
  return (
    <div className="fixed inset-0 z-[220] grid place-items-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ark-onboarding-title">
      <section className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
        <div className="flex items-center justify-between gap-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">{current.eyebrow}</p><p className="text-xs font-black text-slate-400">{step + 1} of {STEPS.length}</p></div>
        <h2 id="ark-onboarding-title" className="mt-3 text-3xl font-black tracking-tight">{current.title}</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{current.body}</p>
        <div className="mt-6 space-y-3">{current.items.map(([title, description]) => <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-black">{title}</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{description}</p></div>)}</div>
        <div className="mt-7 flex items-center justify-between gap-3"><button type="button" onClick={finish} className="px-2 py-3 text-xs font-black text-slate-500">Skip</button><div className="flex gap-2">{step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700">Back</button>}<button type="button" onClick={() => step === STEPS.length - 1 ? finish() : setStep((value) => value + 1)} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{step === STEPS.length - 1 ? "Open Dashboard" : "Next"}</button></div></div>
      </section>
    </div>
  );
}
