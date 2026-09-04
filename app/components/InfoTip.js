"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_GUTTER = 12;
const POPOVER_GAP = 8;
const MOBILE_BREAKPOINT = 640;

function popoverPosition(trigger, align) {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const mobile = viewportWidth < MOBILE_BREAKPOINT;

  if (mobile) {
    return {
      mobile,
      left: VIEWPORT_GUTTER,
      width: Math.max(0, viewportWidth - VIEWPORT_GUTTER * 2),
      top: "50%",
      transform: "translateY(-50%)",
      maxHeight: "min(65dvh, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem))",
    };
  }

  const width = Math.min(320, viewportWidth - VIEWPORT_GUTTER * 2);
  const preferredLeft = align === "right" ? rect.right - width : rect.left;
  const left = Math.min(
    Math.max(VIEWPORT_GUTTER, preferredLeft),
    viewportWidth - width - VIEWPORT_GUTTER,
  );
  const below = viewportHeight - rect.bottom - POPOVER_GAP - VIEWPORT_GUTTER;
  const above = rect.top - POPOVER_GAP - VIEWPORT_GUTTER;
  const opensBelow = below >= 160 || below >= above;

  if (Math.max(below, above) < 96) {
    return {
      mobile,
      left,
      width,
      top: VIEWPORT_GUTTER,
      maxHeight: Math.max(0, viewportHeight - VIEWPORT_GUTTER * 2),
    };
  }

  return opensBelow
    ? { mobile, left, width, top: rect.bottom + POPOVER_GAP, maxHeight: below }
    : { mobile, left, width, bottom: viewportHeight - rect.top + POPOVER_GAP, maxHeight: above };
}

export default function InfoTip({ label, children, align = "left" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const id = useId();
  const titleId = useId();
  const rootRef = useRef(null);
  const popoverRef = useRef(null);

  function updatePosition() {
    if (rootRef.current) setPosition(popoverPosition(rootRef.current, align));
  }

  function toggle() {
    if (!open) updatePosition();
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePress(event) {
      if (!rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    function reposition() {
      if (rootRef.current) setPosition(popoverPosition(rootRef.current, align));
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [align, open]);

  const popover = open && position ? <>
    {position.mobile && <div aria-hidden="true" className="fixed inset-0 z-[309] bg-slate-950/35" />}
    <span
      ref={popoverRef}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed z-[310] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left normal-case tracking-normal text-slate-950 shadow-2xl sm:rounded-xl"
      style={{
        left: position.left,
        width: position.width,
        top: position.top,
        bottom: position.bottom,
        maxHeight: position.maxHeight,
        transform: position.transform,
      }}
    >
      <span className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
        <span id={titleId} className="text-sm font-black">{label || "More information"}</span>
        <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-lg font-black text-slate-700" aria-label="Close explanation">×</button>
      </span>
      <span className="min-h-0 overflow-y-auto px-4 py-3 text-sm font-semibold leading-6 text-slate-700">{children}</span>
    </span>
  </> : null;

  return (
    <span ref={rootRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label || "More information"}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={toggle}
        className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 bg-white text-[11px] font-black leading-none text-slate-600 shadow-sm transition hover:border-slate-500 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        ?
      </button>
      {popover && createPortal(popover, document.body)}
    </span>
  );
}
