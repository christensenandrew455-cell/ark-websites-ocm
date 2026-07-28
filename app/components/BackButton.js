"use client";

import Link from "next/link";

function BackArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

const baseClass = "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white text-slate-950 shadow-sm transition active:scale-95";

export default function BackButton({ href, onClick, className = "", label = "Back" }) {
  const classes = `${baseClass} ${className}`.trim();
  if (href) {
    return <Link href={href} aria-label={label} title={label} className={classes}><BackArrow /></Link>;
  }
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={classes}><BackArrow /></button>;
}
