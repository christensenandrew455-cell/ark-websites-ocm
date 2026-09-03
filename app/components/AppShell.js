"use client";

import { Capacitor } from "@capacitor/core";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import FirstVisitGuides from "./GuidedOnboarding";
import { BillingStatusProvider, useBillingStatus } from "./BillingStatusProvider";
import LegalAcceptanceGate from "./LegalAcceptanceGate";
import NativeAppSetup from "./NativeAppSetup";
import { billingPaymentDeadline } from "../lib/billingNotice";
import { appleIapAvailable } from "../lib/appleIapClient";
import { requestUnsavedNavigation } from "./UnsavedChangesPrompt";

const AUTH_PUBLIC_PATHS = ["/login", "/signup", "/setup/business", "/setup/personalization", "/forgot-password", "/docs"];
const POLICY_PUBLIC_PATHS = ["/terms", "/privacy"];

function matchesPath(pathname, paths) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function LoadingScreen({ message = "Loading client center…" }) {
  return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-sm font-semibold text-blue-50">{message}</main>;
}

function AccountLoadProblem({ message, retry, loading, logout }) {
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-5 text-slate-950"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-lg"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-xl font-black text-amber-800">!</div><h1 className="mt-5 text-2xl font-black tracking-tight">Couldn’t load your account</h1><p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{message}</p><button type="button" disabled={loading} onClick={retry} className="mt-5 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{loading ? "Loading…" : "Try again"}</button><button type="button" onClick={logout} className="mt-2 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700">Sign out</button></section></main>;
}

function PullToRefresh({ children }) {
  const startY = useRef(0);
  const tracking = useRef(false);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function handleTouchStart(event) {
    if (refreshing || window.scrollY > 0 || event.touches.length !== 1) return;
    startY.current = event.touches[0].clientY;
    tracking.current = true;
  }

  function handleTouchMove(event) {
    if (!tracking.current || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - startY.current;
    if (delta <= 0) return setDistance(0);
    if (event.cancelable) event.preventDefault();
    setDistance(Math.min(96, delta * 0.45));
  }

  function handleTouchEnd() {
    if (!tracking.current) return;
    tracking.current = false;
    if (distance >= 60) {
      setRefreshing(true);
      setDistance(72);
      window.setTimeout(() => window.location.reload(), 120);
      return;
    }
    setDistance(0);
  }

  const label = refreshing ? "Refreshing client center…" : distance >= 60 ? "Release to refresh" : "Pull to refresh";
  return <div className="ark-pull-to-refresh ark-workspace-surface relative min-h-screen overflow-x-hidden" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>{(distance > 0 || refreshing) && <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center"><div className="flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-lg">{refreshing && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}{label}</div></div>}<div className="ark-pull-to-refresh-content" style={{ transform: distance > 0 ? `translateY(${distance}px)` : "none", transition: tracking.current ? "none" : "transform 160ms ease-out" }}>{children}</div></div>;
}

function formatDeadline(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

function BillingRefreshProblem({ refresh, loading, compact = false }) {
  return <div role="status" aria-live="polite" className={compact ? "flex items-center gap-3 rounded-xl border border-slate-300/80 bg-white/80 px-3 py-2.5" : "mx-auto flex max-w-6xl items-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-sm"}><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-black text-slate-700">!</span><div className="min-w-0 flex-1"><p className="text-xs font-black text-slate-800">Payment status couldn’t refresh</p><p className="mt-0.5 text-[11px] font-semibold leading-4 text-slate-500">Connect to the internet, then try again.</p></div><button type="button" disabled={loading} onClick={refresh} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-black text-slate-800 disabled:opacity-50">{loading ? "Checking…" : "Try again"}</button></div>;
}

function PaymentNotice() {
  const { status, error, refresh, loading, openBillingPortal, openingBilling } = useBillingStatus();
  const [nativeIos, setNativeIos] = useState(false);
  useEffect(() => { setNativeIos(appleIapAvailable()); }, []);
  if (!status.showNotice && !error) return null;
  if (!status.showNotice) return <section className="border-b border-slate-200 bg-slate-100 px-3 py-3"><BillingRefreshProblem refresh={refresh} loading={loading} /></section>;

  const restricted = status.restricted;
  const appleBilling = status.billingProvider === "apple";
  const stripeManagedOutsideIos = nativeIos && !appleBilling;
  const title = "Update your payment method";
  const body = appleBilling
    ? "Receptionist and new leads are paused. Manage the subscription with Apple to restore service."
    : stripeManagedOutsideIos
      ? "Receptionist and new leads are paused. Open the ARK website to update billing."
    : "Receptionist and new leads are paused. Update payment within seven days to keep the account.";
  const deadlineValue = appleBilling ? "" : billingPaymentDeadline(status);
  const deadline = formatDeadline(deadlineValue);
  const overdue = true;
  const sectionClass = restricted ? "border-b border-red-200 bg-red-50 px-3 py-4" : "border-b border-amber-200 bg-amber-50 px-3 py-4";
  const accentClass = restricted ? "bg-red-700 text-white" : "bg-amber-500 text-amber-950";
  const titleClass = restricted ? "text-red-950" : "text-amber-950";
  const bodyClass = restricted ? "text-red-900" : "text-amber-900";

  return <section className={sectionClass}><div className="mx-auto max-w-6xl"><div className="flex items-start gap-3"><span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg font-black shadow-sm ${accentClass}`}>!</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className={`text-base font-black ${titleClass}`}>{title}</h2>{overdue && <span className="rounded-full bg-red-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">Paused</span>}</div><p className={`mt-1 text-xs font-semibold leading-5 ${bodyClass}`}>{body}</p></div></div><div className={`mt-3 grid gap-2 ${stripeManagedOutsideIos ? "" : "sm:grid-cols-[minmax(0,1fr)_auto]"}`}><div className="rounded-2xl border border-white/90 bg-white/80 px-4 py-3 shadow-sm"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{appleBilling ? "Billing recovery" : "Update before"}</p>{deadline ? <time dateTime={deadlineValue} className="mt-1 block text-base font-black text-slate-950">{deadline}</time> : <p className="mt-1 text-sm font-black text-slate-700">{appleBilling ? "Managed by Apple" : "Checking the exact deadline…"}</p>}</div>{!stripeManagedOutsideIos && <button type="button" onClick={openBillingPortal} disabled={openingBilling} className="grid min-h-12 place-items-center rounded-xl bg-slate-950 px-5 py-3 text-center text-xs font-black text-white shadow-sm disabled:opacity-60">{openingBilling ? appleBilling ? "Opening Apple…" : "Opening Stripe…" : appleBilling ? "Manage Apple subscription" : "Update payment method"}</button>}</div>{error && <div className="mt-2"><BillingRefreshProblem refresh={refresh} loading={loading} compact /></div>}</div></section>;
}

function WorkspaceHeader({ profile, pathname, logout }) {
  const businessName = profile?.businessName || "Your Business";
  const subtitle = businessName;
  const settingsHref = "/settings";
  const settingsActive = pathname.startsWith(settingsHref);
  return <>
    <header className="ark-workspace-header fixed inset-x-0 z-[60] border-b border-blue-950 bg-[#071a3d] px-3 py-3 shadow-sm sm:px-5 md:px-8 md:py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0 leading-tight"><p className="truncate text-lg font-black tracking-tight text-white sm:text-2xl">ARK Client Center</p><p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-blue-200 sm:text-xs">{subtitle}</p></div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => requestUnsavedNavigation("Sign Out", logout)} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-black text-blue-50 shadow-sm sm:px-4 sm:py-2.5">Sign out</button>
          <Link href={settingsHref} aria-label="Settings" title="Settings" className={settingsActive ? "grid h-9 w-9 place-items-center rounded-xl bg-white text-lg text-blue-950 shadow-sm sm:h-10 sm:w-10" : "grid h-9 w-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-lg text-blue-50 shadow-sm sm:h-10 sm:w-10"}><span aria-hidden="true">⚙</span></Link>
        </div>
      </div>
    </header>
    <div className="ark-workspace-header-spacer" aria-hidden="true" />
  </>;
}

function CustomerWorkspace({ children, pathname, isPolicyPublic, profile, logout }) {
  const router = useRouter();
  const { status, loading: billingLoading } = useBillingStatus();
  const restrictedPathAllowed = pathname === "/" || pathname.startsWith("/leads") || pathname.startsWith("/review-my-clients") || pathname.startsWith("/settings") || matchesPath(pathname, POLICY_PUBLIC_PATHS);
  useEffect(() => {
    if (!billingLoading && status.restricted && !restrictedPathAllowed) router.replace("/");
  }, [billingLoading, restrictedPathAllowed, router, status.restricted]);
  if (!billingLoading && status.restricted && !restrictedPathAllowed) return <LoadingScreen message="Opening the payment-restricted account…" />;
  return <><WorkspaceHeader profile={profile} pathname={pathname} logout={logout} /><PullToRefresh>{!isPolicyPublic && <LegalAcceptanceGate />}<PaymentNotice /><NativeAppSetup />{children}</PullToRefresh>{!status.restricted && <FirstVisitGuides />}</>;
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, profileError, loading, logout, refreshProfile } = useAuth();
  const isAuthPublic = matchesPath(pathname, AUTH_PUBLIC_PATHS);
  const isPolicyPublic = matchesPath(pathname, POLICY_PUBLIC_PATHS);
  const isPublic = isAuthPublic || isPolicyPublic;

  useEffect(() => {
    document.documentElement.classList.toggle("ark-dark", profile?.darkMode === true);
  }, [profile?.darkMode]);

  useEffect(() => {
    const stiffDashboard = pathname === "/";
    if (stiffDashboard) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.classList.toggle("ark-stiff-dashboard", stiffDashboard);
    return () => document.documentElement.classList.remove("ark-stiff-dashboard");
  }, [pathname]);

  useEffect(() => {
    const orientation = window.screen?.orientation;
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
    if (!orientation?.lock || (!Capacitor.isNativePlatform() && !standalone)) return;
    orientation.lock("portrait-primary").catch(() => orientation.lock("portrait").catch(() => null));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (user && (pathname === "/login" || pathname === "/signup")) {
      router.replace("/");
      return;
    }
  }, [isAuthPublic, isPublic, loading, pathname, router, user]);

  if (loading) return <LoadingScreen />;
  if (!user && isPublic) return children;
  if (!user) return <LoadingScreen />;
  if (isAuthPublic) return children;
  if (!profile) return <AccountLoadProblem message={profileError || "We couldn’t load your account information."} retry={refreshProfile} loading={loading} logout={logout} />;

  return <BillingStatusProvider><CustomerWorkspace pathname={pathname} isPolicyPublic={isPolicyPublic} profile={profile} logout={logout}>{children}</CustomerWorkspace></BillingStatusProvider>;
}
