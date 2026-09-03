"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppShell from "./AppShell";
import { useAuth } from "./AuthProvider";

function routeMatches(pathname, values) {
  return values.some((value) => pathname === value || pathname.startsWith(`${value}/`));
}

function Waiting({ children }) {
  return <main className="ark-auth-page grid min-h-screen place-items-center p-6 text-sm font-semibold text-blue-50">{children}</main>;
}

function requiredOnboardingPath(profile) {
  const status = profile?.status;
  if (status === "pending_verification") return "/signup/verify";
  if (["pending_business_setup", "pending_personalization", "pending_payment"].includes(status) && profile?.identityVerificationVerified !== true) return "/signup/verify";
  if (status === "pending_business_setup") return "/setup/business";
  if (status === "pending_personalization") return "/setup/personalization";
  if (status === "pending_payment") return "/signup/payment";
  if (status === "active" && profile?.identityVerificationRequired && !profile?.identityVerificationVerified) return "/signup/verify";
  return "";
}

export default function SignupFlowShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const onboardingPage = routeMatches(pathname, ["/signup/verify", "/setup/business", "/setup/personalization", "/signup/payment"]);
  const publicInformationPage = routeMatches(pathname, ["/terms", "/privacy", "/docs"]);
  const requiredPath = user ? requiredOnboardingPath(profile) : "";
  const allowedPendingPath = requiredPath === "/signup/verify"
    ? pathname === "/signup/verify"
    : requiredPath === "/setup/business"
      ? routeMatches(pathname, ["/signup/verify", "/setup/business"])
      : requiredPath === "/setup/personalization"
        ? routeMatches(pathname, ["/signup/verify", "/setup/business", "/setup/personalization"])
        : requiredPath === "/signup/payment"
          ? routeMatches(pathname, ["/signup/verify", "/setup/business", "/setup/personalization", "/signup/payment"])
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
