"use client";

import { useRouter } from "next/navigation";

function BackArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

const baseClass = "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-blue-200 bg-white text-blue-950 shadow-sm shadow-blue-950/10 transition active:scale-95";

export default function BackButton({ href, onClick, className = "", label = "Back" }) {
  const router = useRouter();
  const classes = `${baseClass} ${className}`.trim();

  function goBack() {
    if (onClick) {
      onClick();
      return;
    }
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(href || "/");
  }

  return <button type="button" onClick={goBack} aria-label={label} title={label} className={classes}><BackArrow /></button>;
}
