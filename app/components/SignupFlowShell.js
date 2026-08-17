"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppShell from "./AppShell";
import { useAuth } from "./AuthProvider";

function routeMatches(pathname, values) {
  return values.some((value) => pathname === value || pathname.startsWith(`${value}/`));
}

function Waiting({ children }) {
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-sm font-semibold text-slate-600 shadow-sm">{children}</div></main>;
}

function requiredOnboardingPath(profile) {
  const status = profile?.status;
  if (status === "pending_verification") return "/signup/verify";
  if (["pending_business_setup", "pending_payment"].includes(status) && profile?.identityVerificationVerified !== true) return "/signup/verify";
  if (status === "pending_business_setup") return "/setup/business";
  if (status === "pending_payment") return "/signup/payment";
  if (status === "active" && profile?.identityVerificationRequired && !profile?.identityVerificationVerified) return "/signup/verify";
  return "";
}

export default function SignupFlowShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const onboardingPage = routeMatches(pathname, ["/signup/verify", "/setup/business", "/signup/payment"]);
  const publicInformationPage = routeMatches(pathname, ["/terms", "/privacy", "/docs"]);
  const requiredPath = user ? requiredOnboardingPath(profile) : "";
  const allowedPendingPath = requiredPath === "/signup/verify"
    ? pathname === "/signup/verify"
    : requiredPath === "/setup/business"
      ? routeMatches(pathname, ["/signup/verify", "/setup/business"])
      : requiredPath === "/signup/payment"
        ? routeMatches(pathname, ["/signup/verify", "/setup/business", "/signup/payment"])
        : false;

  useEffect(() => {
    if (loading) return;
    if (requiredPath && !allowedPendingPath && !publicInformationPage) {
      router.replace(requiredPath);
      return;
    }
  }, [allowedPendingPath, loading, profile?.status, publicInformationPage, requiredPath, router]);

  if (loading) return <Waiting>Loading client center…</Waiting>;
  if (requiredPath && !allowedPendingPath && !publicInformationPage) return <Waiting>Opening account setup…</Waiting>;
  if (onboardingPage || (requiredPath && publicInformationPage)) return children;
  return <AppShell>{children}</AppShell>;
}
