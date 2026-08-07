"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

const LABEL_CLASS = "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs";

export default function ClientDeclineNoticeSettings() {
  const { user, isAdmin, isEmployee } = useAuth();
  const [mountNode, setMountNode] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let observer;
    let slot;

    function attach() {
      const heading = [...document.querySelectorAll(".settings-layered h2")]
        .find((node) => node.textContent?.trim() === "Customization");
      const panel = heading?.parentElement?.nextElementSibling;
      const controls = panel?.querySelector(".space-y-6");
      if (!controls) {
        setMountNode(null);
        return false;
      }
      slot = controls.querySelector(".client-decline-notice-slot");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "client-decline-notice-slot";
        const employeeAccess = [...controls.children].find((child) => child.querySelector?.("[class*='Employee access']"));
        if (employeeAccess) controls.insertBefore(slot, employeeAccess);
        else controls.appendChild(slot);
      }
      setMountNode(slot);
      return true;
    }

    attach();
    const root = document.querySelector(".settings-layered");
    if (root) {
      observer = new MutationObserver(attach);
      observer.observe(root, { childList: true, subtree: true });
    }
    return () => {
      observer?.disconnect();
      if (slot?.parentNode) slot.parentNode.removeChild(slot);
      setMountNode(null);
    };
  }, []);

  useEffect(() => {
    if (!user || isAdmin || isEmployee) return;
    let active = true;
    setLoading(true);
    user.getIdToken(true)
      .then((token) => fetch("/api/account/client-decline-notice", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) throw new Error(data.error || "Could not load the decline notice setting.");
        setEnabled(data.enabled !== false);
        setError("");
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [isAdmin, isEmployee, user]);

  async function update(checked) {
    if (!user || saving) return;
    const previous = enabled;
    setEnabled(checked);
    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/client-decline-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: checked }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update the decline notice setting.");
      setEnabled(data.enabled !== false);
    } catch (saveError) {
      setEnabled(previous);
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!mountNode) return null;
  return createPortal(
    <div>
      <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
        <span>
          <span className={LABEL_CLASS}>Client decline notice</span>
          <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">Automatically text a client when you decline their estimate request.</span>
        </span>
        <input
          type="checkbox"
          disabled={loading || saving}
          checked={enabled}
          onChange={(event) => update(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-slate-950"
        />
      </label>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </div>,
    mountNode,
  );
}
