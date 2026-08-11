"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadOwnerSignupDraft } from "../lib/ownerSignupStorage";

export default function SignupAboutContinue() {
  const router = useRouter();

  function next() {
    router.push(loadOwnerSignupDraft() ? "/signup/status" : "/signup");
  }

  return <div className="mt-8 grid gap-3 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:grid-cols-2 sm:pb-8">
    <Link href="/setup/business?signup=1" className="rounded-2xl border border-slate-300 bg-white px-6 py-4 text-center text-sm font-black text-slate-700">Back</Link>
    <button type="button" onClick={next} className="rounded-2xl bg-slate-950 px-6 py-4 text-center text-sm font-black text-white shadow-lg">Next</button>
  </div>;
}
