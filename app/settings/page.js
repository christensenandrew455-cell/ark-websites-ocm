"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import EmployeeAccessSettings from "../components/EmployeeAccessSettings";
import SettingsPanel from "../components/SettingsPanel";
import { useAuth } from "../components/AuthProvider";

const RETENTION_OPTIONS = [
  { value: 1, label: "Delete after 1 day" },
  { value: 7, label: "Delete after 1 week" },
  { value: 30, label: "Delete after 1 month" },
];

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

function EmployeeAccessButton({ onOpen }) {
  const { profile } = useAuth();
  const [mountNode, setMountNode] = useState(null);

  useEffect(() => {
    if (profile?.employeesEnabled !== true) return undefined;
    let observer;
    let slot;
    function attach() {
      const list = document.querySelector(".settings-layered > main > div > .space-y-3");
      if (!list) return false;
      slot = list.querySelector(".settings-employee-access-slot");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "settings-employee-access-slot";
        list.appendChild(slot);
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
  }, [profile?.employeesEnabled]);

  if (!mountNode) return null;
  return createPortal(
    <button type="button" onClick={onOpen} className="min-h-28 w-full rounded-2xl border border-slate-300 bg-slate-50 p-5 text-left shadow-sm transition active:scale-[0.99] sm:min-h-32 sm:rounded-3xl sm:p-7">
      <h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">Employee Access Settings</h2>
    </button>,
    mountNode
  );
}

function MessageRetentionControl() {
  const { user } = useAuth();
  const [mountNode, setMountNode] = useState(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/lead-messages/retention", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setRetentionDays(Number(data.retentionDays || 30));
    } catch {}
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let observer;
    let slot;
    function attach() {
      const heading = Array.from(document.querySelectorAll(".settings-layered h2")).find((item) => item.textContent?.trim() === "Customization");
      const panel = heading?.parentElement?.nextElementSibling;
      const form = panel?.querySelector("form");
      if (!form) return false;
      slot = form.querySelector(".settings-message-retention-slot");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "settings-message-retention-slot";
        const appTools = Array.from(form.querySelectorAll(":scope > section")).find((section) => section.querySelector("h3")?.textContent?.trim() === "App Tools");
        if (appTools) appTools.after(slot);
        else form.appendChild(slot);
      }
      Array.from(form.querySelectorAll("p")).forEach((paragraph) => {
        if (paragraph.textContent?.includes("Messages for Employees and employee contact visibility")) paragraph.style.display = "none";
      });
      setMountNode(slot);
      return true;
    }
    if (!attach()) {
      observer = new MutationObserver(() => attach());
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      observer?.disconnect();
      if (slot?.parentNode) slot.parentNode.removeChild(slot);
      setMountNode(null);
    };
  }, []);

  async function updateRetention(value) {
    if (!user || saving) return;
    const previous = retentionDays;
    const next = Number(value);
    setRetentionDays(next);
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/business/lead-messages/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ retentionDays: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update message auto-delete.");
      setRetentionDays(Number(data.retentionDays || 30));
      setNotice("Saved.");
    } catch (saveError) {
      setRetentionDays(previous);
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!mountNode) return null;
  return createPortal(
    <section className="mt-7">
      <h3 className="text-lg font-black">Message Auto-Delete</h3>
      <select value={retentionDays} disabled={saving} onChange={(event) => updateRetention(event.target.value)} className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-black outline-none focus:border-slate-950 disabled:opacity-50 sm:w-auto">
        {RETENTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {notice && <p className="mt-2 text-xs font-bold text-green-700">{notice}</p>}
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </section>,
    mountNode
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { isAdmin, isEmployee, loading } = useAuth();
  const [employeeAccessOpen, setEmployeeAccessOpen] = useState(false);

  useEffect(() => {
    if (!loading && (isAdmin || isEmployee)) router.replace("/");
  }, [isAdmin, isEmployee, loading, router]);

  if (loading || isAdmin || isEmployee) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening dashboard…</main>;
  }

  if (employeeAccessOpen) {
    return <div className="settings-layered"><EmployeeAccessSettings onBack={() => setEmployeeAccessOpen(false)} /></div>;
  }

  return <div className="settings-layered"><style>{`
    .settings-layered > main { background-color: #e2e8f0 !important; }
    .settings-layered > main > div > .space-y-3 { border: 1px solid #cbd5e1; border-radius: 2rem; background: rgba(203, 213, 225, .72); padding: .75rem; box-shadow: inset 0 1px 2px rgba(15, 23, 42, .08); }
    .settings-layered > main > div > .space-y-3 > button { background-color: #f8fafc !important; border-color: #cbd5e1 !important; }
    .settings-layered > main section.bg-white { background-color: #f8fafc !important; border-color: #cbd5e1 !important; }
    .settings-layered > main a.bg-white, .settings-layered > main button.bg-white { background-color: #f8fafc !important; }
    @media (min-width: 640px) { .settings-layered > main > div > .space-y-3 { padding: 1.25rem; } }
  `}</style><SettingsPanel /><SettingsBillingEstimate /><EmployeeAccessButton onOpen={() => setEmployeeAccessOpen(true)} /><MessageRetentionControl /></div>;
}
