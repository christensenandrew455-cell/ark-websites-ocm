"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SettingsPanel from "../components/SettingsPanel";
import { useAuth } from "../components/AuthProvider";

function money(cents = 0, currency = "usd") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(Number(cents || 0) / 100);
  } catch {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }
}

function SettingsBillingEstimate() {
  const { user } = useAuth();
  const [mountNode, setMountNode] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let observer;
    let slot;
    function attach() {
      const billing = document.querySelector("#billing");
      if (!billing) return false;
      slot = billing.querySelector(".settings-billing-estimate-slot");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "settings-billing-estimate-slot";
        const headingRow = billing.firstElementChild;
        if (headingRow?.nextSibling) billing.insertBefore(slot, headingRow.nextSibling);
        else billing.appendChild(slot);
      }
      setMountNode(slot);
      return true;
    }
    if (!attach()) {
      observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      observer?.disconnect();
      if (slot?.parentNode) slot.parentNode.removeChild(slot);
      setMountNode(null);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken(true)
      .then((token) => fetch("/api/billing/monthly-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => { if (active && response.ok) setSummary(data); })
      .catch(() => null);
    return () => { active = false; };
  }, [user]);

  if (!mountNode) return null;
  return createPortal(
    <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Current billing period</p>
      <p className="mt-2 text-4xl font-black tracking-tight">{summary ? money(summary.amountDue, summary.currency) : "—"}</p>
      <p className="mt-1 text-xs font-bold text-slate-300">Estimated monthly total</p>
    </div>,
    mountNode
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { isAdmin, isEmployee, loading } = useAuth();

  useEffect(() => {
    if (!loading && (isAdmin || isEmployee)) router.replace("/");
  }, [isAdmin, isEmployee, loading, router]);

  if (loading || isAdmin || isEmployee) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening dashboard…</main>;
  }

  return <><SettingsPanel /><SettingsBillingEstimate /></>;
}
