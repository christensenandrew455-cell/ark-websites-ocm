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
  const { user, profile, isAdmin, loading } = useAuth();
  const signupPage = routeMatches(pathname, ["/signup/status", "/signup/complete"]);
  const setupPage = routeMatches(pathname, ["/setup/business"]);
  const publicInformationPage = routeMatches(pathname, ["/terms", "/privacy", "/about", "/support", "/docs"]);
  const unfinished = Boolean(user && !isAdmin && profile?.status !== "active");
  const needsBusinessSetup = Boolean(user && !isAdmin && profile?.status === "active" && profile?.businessSetupComplete === false);

  useEffect(() => {
    if (loading) return;

    if (user && !initialAuthenticatedRouteHandled.current) {
      initialAuthenticatedRouteHandled.current = true;
      if (!unfinished && !needsBusinessSetup && pathname !== "/") {
        router.replace("/");
        return;
      }
    }

    if (setupPage && !user) {
      router.replace("/login");
      return;
    }
    if (setupPage && isAdmin) {
      router.replace("/");
      return;
    }
    if (unfinished && !signupPage && !publicInformationPage) {
      router.replace("/signup/status");
      return;
    }
    if (needsBusinessSetup && !setupPage && !publicInformationPage && !signupPage) {
      router.replace("/setup/business");
      return;
    }
    if (user && !isAdmin && profile?.status === "active" && pathname === "/signup/status") {
      router.replace(needsBusinessSetup ? "/setup/business" : "/");
    }
  }, [isAdmin, loading, needsBusinessSetup, pathname, profile?.status, publicInformationPage, router, setupPage, signupPage, unfinished, user]);

  if (loading) return <Waiting>Loading client center…</Waiting>;
  if (setupPage && (!user || isAdmin)) return <Waiting>Opening the correct account page…</Waiting>;
  if (signupPage || setupPage) return children;
  if (unfinished && publicInformationPage) return children;
  if (unfinished) return <Waiting>Opening account verification…</Waiting>;
  if (needsBusinessSetup && publicInformationPage) return children;
  if (needsBusinessSetup) return <Waiting>Opening business setup…</Waiting>;

  return (
    <AppShell>
      {isAdmin && pathname.startsWith("/connections") && <AdminPendingApplications />}
      {children}
    </AppShell>
  );
}
