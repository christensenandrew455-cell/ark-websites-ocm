"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppShell from "./AppShell";
import AdminPendingApplications from "./AdminPendingApplications";
import { useAuth } from "./AuthProvider";

function routeMatches(pathname, values) {
  return values.some((value) => pathname === value || pathname.startsWith(`${value}/`));
}

function Waiting({ children }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-sm font-semibold text-slate-600 shadow-sm">{children}</div>
    </main>
  );
}

export default function SignupFlowShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, isAdmin, loading } = useAuth();
  const signupPage = routeMatches(pathname, ["/signup/status", "/signup/complete"]);
  const policyPage = routeMatches(pathname, ["/terms", "/privacy"]);
  const unfinished = Boolean(user && !isAdmin && profile?.status !== "active");

  useEffect(() => {
    if (loading) return;
    if (unfinished && !signupPage && !policyPage) {
      router.replace("/signup/status");
      return;
    }
    if (user && !isAdmin && profile?.status === "active" && pathname === "/signup/status") {
      router.replace("/");
    }
  }, [isAdmin, loading, pathname, policyPage, profile?.status, router, signupPage, unfinished, user]);

  if (loading) return <Waiting>Loading client center…</Waiting>;
  if (signupPage) return children;
  if (unfinished && policyPage) return children;
  if (unfinished) return <Waiting>Opening account verification…</Waiting>;

  return (
    <AppShell>
      {isAdmin && pathname.startsWith("/connections") && <AdminPendingApplications />}
      {children}
    </AppShell>
  );
}
