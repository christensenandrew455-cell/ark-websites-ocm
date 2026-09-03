"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function InfoTip({ label, children, align = "left" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePress(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label || "More information"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 bg-white text-[11px] font-black leading-none text-slate-600 shadow-sm transition hover:border-slate-500 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-7 z-[90] w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-slate-950 p-3 text-left text-xs font-semibold normal-case leading-5 tracking-normal text-white shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
