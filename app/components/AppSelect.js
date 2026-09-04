"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_GUTTER = 12;
const MENU_GAP = 6;
const MOBILE_BREAKPOINT = 640;

function normalizeOptions(options = []) {
  return options.map((option) => typeof option === "string"
    ? { value: option, label: option }
    : option);
}

function menuPosition(trigger, align = "left") {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const mobile = viewportWidth < MOBILE_BREAKPOINT;

  if (mobile) {
    return {
      mobile,
      left: VIEWPORT_GUTTER,
      width: Math.max(0, viewportWidth - VIEWPORT_GUTTER * 2),
      bottom: `calc(env(safe-area-inset-bottom) + ${VIEWPORT_GUTTER}px)`,
      maxHeight: "min(70dvh, calc(100dvh - env(safe-area-inset-bottom) - 1.5rem))",
    };
  }

  const width = Math.min(Math.max(rect.width, 220), viewportWidth - VIEWPORT_GUTTER * 2);
  const preferredLeft = align === "right" ? rect.right - width : rect.left;
  const left = Math.min(
    Math.max(VIEWPORT_GUTTER, preferredLeft),
    viewportWidth - width - VIEWPORT_GUTTER,
  );
  const below = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_GUTTER;
  const above = rect.top - MENU_GAP - VIEWPORT_GUTTER;
  const opensBelow = below >= 180 || below >= above;

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
    ? {
        mobile,
        left,
        width,
        top: rect.bottom + MENU_GAP,
        maxHeight: below,
      }
    : {
        mobile,
        left,
        width,
        bottom: viewportHeight - rect.top + MENU_GAP,
        maxHeight: above,
      };
}

export default function AppSelect({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  placeholder = "Choose",
  disabled = false,
  align = "left",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [highlighted, setHighlighted] = useState(-1);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const optionRefs = useRef([]);
  const itemsRef = useRef([]);
  const listboxId = useId();
  const items = normalizeOptions(options);
  itemsRef.current = items;
  const selectedIndex = items.findIndex((item) => String(item.value) === String(value ?? ""));
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;
  const controlLabel = ariaLabel || label || "Choose an option";

  function updatePosition() {
    if (triggerRef.current) setPosition(menuPosition(triggerRef.current, align));
  }

  function openMenu(startIndex = selectedIndex >= 0 ? selectedIndex : 0) {
    if (disabled) return;
    updatePosition();
    setHighlighted(Math.max(0, startIndex));
    setOpen(true);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    setHighlighted(-1);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(item) {
    onChange(item.value);
    closeMenu({ restoreFocus: true });
  }

  useEffect(() => {
    if (!open) return undefined;

    function dismiss(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        closeMenu();
      }
    }

    function handleKeyboard(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setHighlighted(-1);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (event.key === "Tab") {
        setOpen(false);
        setHighlighted(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!itemsRef.current.length) return;
        setHighlighted((current) => (current + 1 + itemsRef.current.length) % itemsRef.current.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!itemsRef.current.length) return;
        setHighlighted((current) => (current - 1 + itemsRef.current.length) % itemsRef.current.length);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setHighlighted(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setHighlighted(itemsRef.current.length - 1);
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && highlighted >= 0 && itemsRef.current[highlighted]) {
        event.preventDefault();
        onChange(itemsRef.current[highlighted].value);
        setOpen(false);
        setHighlighted(-1);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }

    function reposition() {
      if (triggerRef.current) setPosition(menuPosition(triggerRef.current, align));
    }

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", handleKeyboard);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", handleKeyboard);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [align, highlighted, onChange, open]);

  useEffect(() => {
    if (open && highlighted >= 0) optionRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function handleTriggerKeyDown(event) {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (open) return;
    const startIndex = event.key === "ArrowUp" ? items.length - 1 : selectedIndex >= 0 ? selectedIndex : 0;
    openMenu(startIndex);
  }

  const menu = open && position ? <>
    {position.mobile && <div aria-hidden="true" className="fixed inset-0 z-[299] bg-slate-950/35" />}
    <div
      ref={menuRef}
      className="fixed z-[300] flex flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-950 shadow-2xl sm:rounded-xl"
      style={{
        left: position.left,
        width: position.width,
        top: position.top,
        bottom: position.bottom,
        maxHeight: position.maxHeight,
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:hidden">
        <span className="text-sm font-black">{label || controlLabel}</span>
        <button type="button" onClick={() => closeMenu({ restoreFocus: true })} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-lg font-black" aria-label={`Close ${controlLabel}`}>×</button>
      </div>
      <div id={listboxId} role="listbox" aria-label={controlLabel} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
        {items.map((item, index) => {
          const itemSelected = index === selectedIndex;
          const itemHighlighted = index === highlighted;
          return (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              key={`${item.label}-${String(item.value)}`}
              type="button"
              role="option"
              aria-selected={itemSelected}
              onPointerMove={() => setHighlighted(index)}
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm font-bold ${itemHighlighted ? "bg-slate-950 text-white" : "text-slate-800 active:bg-slate-100"}`}
            >
              <span>{item.label}</span>
              {itemSelected && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  </> : null;

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={controlLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleTriggerKeyDown}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 text-left text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      >
        <span className={selected ? "truncate font-semibold text-slate-900" : "truncate text-slate-500"}>{selected?.label || placeholder}</span>
        <span aria-hidden="true" className={`shrink-0 text-xs text-slate-500 transition ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}
