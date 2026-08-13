"use client";

import { useState } from "react";

function EyeIcon({ visible }) {
  return visible
    ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 8 9 8a17.5 17.5 0 0 1-2.1 3.3" /><path d="M6.6 6.6C4.4 8.1 3 12 3 12s3.5 8 9 8a9.8 9.8 0 0 0 4-.8" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12s3.5-8 9-8 9 8 9 8-3.5 8-9 8-9-8-9-8Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
}

export default function PasswordInput({ className = "", containerClassName = "relative mt-2", ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? "Hide password" : "Show password";

  return (
    <div className={containerClassName}>
      <input {...inputProps} type={visible ? "text" : "password"} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={actionLabel}
        aria-pressed={visible}
        title={actionLabel}
        className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      >
        <EyeIcon visible={visible} />
      </button>
    </div>
  );
}
