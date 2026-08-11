"use client";

import { useRouter } from "next/navigation";
import { loadOwnerSignupDraft } from "../lib/ownerSignupStorage";

export default function SignupAboutContinue() {
  const router = useRouter();

  function next() {
    router.push(loadOwnerSignupDraft() ? "/signup/status" : "/signup");
  }

  return <button type="button" onClick={next} className="mt-6 block w-full rounded-2xl bg-slate-950 px-6 py-4 text-center text-sm font-black text-white shadow-lg sm:ml-auto sm:w-fit">Next</button>;
}
