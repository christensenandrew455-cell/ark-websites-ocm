"use client";

import { useEffect, useRef } from "react";
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
  const initialAuthenticatedRouteHandled = useRef(false);
  const { user, profile, isAdmin, isEmployee, loading } = useAuth();
  const signupPage = routeMatches(pathname, ["/signup/status", "/signup/complete"]);
  const employeePendingPage = routeMatches(pathname, ["/employee/pending"]);
  const setupPage = routeMatches(pathname, ["/setup/business"]);
  const publicInformationPage = routeMatches(pathname, ["/terms", "/privacy", "/about", "/support", "/docs"]);
  const employeePending = Boolean(user && isEmployee && profile?.status !== "active");
  const ownerUnfinished = Boolean(user && !isAdmin && !isEmployee && profile?.status !== "active");
  const needsBusinessSetup = Boolean(user && !isAdmin && !isEmployee && profile?.status === "active" && profile?.businessSetupComplete === false);

  useEffect(() => {
    if (loading) return;

    if (user && !initialAuthenticatedRouteHandled.current) {
      initialAuthenticatedRouteHandled.current = true;
      if (!employeePending && !ownerUnfinished && !needsBusinessSetup && pathname !== "/") {
        router.replace("/");
        return;
      }
    }

    if (setupPage && (!user || isAdmin || isEmployee)) {
      router.replace(user ? "/" : "/login");
      return;
    }
    if (employeePending && !employeePendingPage && !publicInformationPage) {
      router.replace("/employee/pending");
      return;
    }
    if (ownerUnfinished && !signupPage && !publicInformationPage) {
      router.replace("/signup/status");
      return;
    }
    if (needsBusinessSetup && !setupPage && !publicInformationPage && !signupPage) {
      router.replace("/setup/business");
      return;
    }
    if (user && isEmployee && profile?.status === "active" && employeePendingPage) {
      router.replace("/");
      return;
    }
    if (user && !isAdmin && !isEmployee && profile?.status === "active" && pathname === "/signup/status") {
      router.replace(needsBusinessSetup ? "/setup/business" : "/");
    }
  }, [employeePending, employeePendingPage, isAdmin, isEmployee, loading, needsBusinessSetup, ownerUnfinished, pathname, profile?.status, publicInformationPage, router, setupPage, signupPage, user]);

  if (loading) return <Waiting>Loading client center…</Waiting>;
  if (setupPage && (!user || isAdmin || isEmployee)) return <Waiting>Opening the correct account page…</Waiting>;
  if (signupPage || setupPage || employeePendingPage) return children;
  if ((employeePending || ownerUnfinished) && publicInformationPage) return children;
  if (employeePending) return <Waiting>Opening employee approval…</Waiting>;
  if (ownerUnfinished) return <Waiting>Opening account verification…</Waiting>;
  if (needsBusinessSetup && publicInformationPage) return children;
  if (needsBusinessSetup) return <Waiting>Opening business setup…</Waiting>;

  return (
    <AppShell>
      {isAdmin && pathname.startsWith("/connections") && <AdminPendingApplications />}
      {children}
    </AppShell>
  );
}
