"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBillingStatus } from "../components/BillingStatusProvider";
import ReviewClientsNative from "../components/ReviewClientsNative";

export default function ReviewMyClientsPage() {
  const router = useRouter();
  const { status, loading } = useBillingStatus();

  useEffect(() => {
    if (!loading && status.restricted) router.replace("/");
  }, [loading, router, status.restricted]);

  if (!loading && status.restricted) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening your available leads…</main>;
  }

  return (
    <div className="review-clients-shell">
      <style>{`.review-clients-shell > main > div > nav:first-child { display: none; }`}</style>
      <ReviewClientsNative />
    </div>
  );
}
