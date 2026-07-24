"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { BillingStatusProvider, useBillingStatus } from "./BillingStatusProvider";
import HelpCenter from "./HelpCenter";
import LegalAcceptanceGate from "./LegalAcceptanceGate";
import NativeAppSetup from "./NativeAppSetup";

const AUTH_PUBLIC_PATHS = ["/login", "/signup", "/signup/complete", "/employee/pending", "/forgot-password", "/about", "/support", "/docs"];
const POLICY_PUBLIC_PATHS = ["/terms", "/privacy"];
const ADMIN_NAV_ITEMS = [
  { label: "Dashboard", mobileLabel: "Dash", href: "/" },
  { label: "Messages", mobileLabel: "Messages", href: "/messages" },
  { label: "Payment", mobileLabel: "Pay", href: "/payment" },
  { label: "Connections", mobileLabel: "Accounts", href: "/connections" },
];
const THEME_KEY = "ark-theme-v1";

function matchesPath(pathname, paths) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function LoadingScreen({ message = "Loading client center…" }) {
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-sm font-semibold text-slate-600 shadow-sm">{message}</div></main>;
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
  return <div className="relative min-h-screen overflow-x-hidden" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>{(distance > 0 || refreshing) && <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center"><div className="flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-lg">{refreshing && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}{label}</div></div>}<div style={{ transform: distance > 0 ? `translateY(${distance}px)` : "none", transition: tracking.current ? "none" : "transform 160ms ease-out" }}>{children}</div></div>;
}

function formatDeadline(value) {
  if (!value) return "the deadline shown in your billing notice";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "the deadline shown in your billing notice" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function PaymentNotice() {
  const { status, error, openBillingPortal, openingBilling } = useBillingStatus();
  if (!status.showNotice && !error) return null;
  const restricted = status.restricted;
  const title = status.phase === "deletion-review" ? "Payment required — account under review" : restricted ? "Payment-restricted mode is active" : "Payment required";
  const body = status.phase === "deletion-review" ? "The balance is still unpaid and the account is waiting for manual review. Payment restores full access automatically when Stripe confirms it." : restricted ? `You can continue receiving new leads and accept them into Clients. Other features are unavailable until payment is completed. Review date: ${formatDeadline(status.reviewAt)}.` : `We have not received the scheduled payment. Update the payment method by ${formatDeadline(status.graceEndsAt)} to keep full access.`;
  return <section className={restricted ? "border-b border-red-300 bg-red-50 px-3 py-4" : "border-b border-amber-300 bg-amber-50 px-3 py-4"}><div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className={restricted ? "text-sm font-black text-red-900" : "text-sm font-black text-amber-950"}>{title}</p><p className={restricted ? "mt-1 text-xs font-semibold leading-5 text-red-800" : "mt-1 text-xs font-semibold leading-5 text-amber-900"}>{body}</p>{error && <p className="mt-1 text-xs font-bold text-red-700">{error}</p>}</div><div className="grid shrink-0 grid-cols-2 gap-2"><button type="button" disabled={openingBilling} onClick={openBillingPortal} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{openingBilling ? "Opening…" : "Update Payment"}</button><Link href="/terms#payment-enforcement" className="rounded-xl border border-slate-400 bg-white px-4 py-2.5 text-center text-xs font-black text-slate-800">Learn More</Link></div></div></section>;
}

function WorkspaceHeader({ profile, pathname, isEmployee, logout }) {
  const businessName = profile?.businessName || "Your Business";
  const subtitle = isEmployee && profile?.employeeName ? `${businessName} · ${profile.employeeName}` : businessName;
  const settingsActive = pathname.startsWith("/settings");
  return <header className="border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5 md:px-8 md:py-4"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3"><div className="min-w-0 leading-tight"><p className="truncate text-lg font-black tracking-tight text-slate-950 sm:text-2xl">ARK Client Center</p><p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:text-xs">{subtitle}</p></div><div className="flex shrink-0 items-center gap-2">{!isEmployee && <Link href="/settings" className={settingsActive ? "rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white sm:px-4 sm:py-2.5" : "rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm sm:px-4 sm:py-2.5"}>Settings</Link>}<button type="button" onClick={logout} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm sm:px-4 sm:py-2.5">Sign out</button></div></div></header>;
}

function CustomerWorkspace({ children, pathname, isPolicyPublic, profile, logout }) {
  const router = useRouter();
  const { status, loading: billingLoading } = useBillingStatus();
  const restrictedPathAllowed = pathname === "/" || pathname.startsWith("/leads") || pathname.startsWith("/review-my-clients") || matchesPath(pathname, POLICY_PUBLIC_PATHS);
  useEffect(() => {
    if (!billingLoading && status.restricted && !restrictedPathAllowed) router.replace("/");
  }, [billingLoading, restrictedPathAllowed, router, status.restricted]);
  if (!billingLoading && status.restricted && !restrictedPathAllowed) return <LoadingScreen message="Opening the payment-restricted account…" />;
  return <PullToRefresh><WorkspaceHeader profile={profile} pathname={pathname} isEmployee={false} logout={logout} />{!isPolicyPublic && <LegalAcceptanceGate />}<PaymentNotice /><NativeAppSetup />{!status.restricted && <HelpCenter />}{children}</PullToRefresh>;
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, isAdmin, isEmployee, loading, logout, selectClientId } = useAuth();
  const isAuthPublic = matchesPath(pathname, AUTH_PUBLIC_PATHS);
  const isPolicyPublic = matchesPath(pathname, POLICY_PUBLIC_PATHS);
  const isPublic = isAuthPublic || isPolicyPublic;
  const selectedClientId = profile?.clientId || "";

  useEffect(() => {
    try {
      document.documentElement.classList.toggle("ark-dark", window.localStorage.getItem(THEME_KEY) === "dark");
    } catch {
      document.documentElement.classList.remove("ark-dark");
    }
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
    if (user && !isAuthPublic && selectedClientId) selectClientId(selectedClientId);
  }, [isAuthPublic, isPublic, loading, pathname, router, selectClientId, selectedClientId, user]);

  if (loading) return <LoadingScreen />;
  if (!user && isPublic) return children;
  if (!user) return <LoadingScreen />;
  if (isAuthPublic) return children;

  const signOutButton = <button type="button" onClick={logout} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm">Sign out</button>;

  if (isAdmin) return <><header className="border-b border-slate-200 bg-white px-3 py-2.5 shadow-sm md:px-8 md:py-4"><div className="mx-auto flex max-w-7xl flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><div className="flex min-w-0 items-center justify-between gap-3"><div className="min-w-0 leading-tight"><p className="truncate text-base font-black tracking-tight text-slate-950 sm:text-xl">ARK Client Center</p><p className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:text-xs">Admin</p></div><div className="sm:hidden">{signOutButton}</div></div><div className="flex min-w-0 items-center gap-2"><nav className="grid min-w-0 flex-1 gap-1 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-none" style={{ gridTemplateColumns: `repeat(${ADMIN_NAV_ITEMS.length}, minmax(0, 1fr))` }}>{ADMIN_NAV_ITEMS.map((item) => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? "min-w-0 rounded-lg bg-white px-1 py-2 text-center text-[9px] font-black text-slate-950 shadow-sm sm:whitespace-nowrap sm:px-3 sm:text-sm" : "min-w-0 rounded-lg px-1 py-2 text-center text-[9px] font-bold text-slate-600 hover:bg-white/60 hover:text-slate-950 sm:whitespace-nowrap sm:px-3 sm:text-sm"}><span className="sm:hidden">{item.mobileLabel}</span><span className="hidden sm:inline">{item.label}</span></Link>; })}</nav><div className="hidden sm:block">{signOutButton}</div></div></div></header>{children}</>;

  if (isEmployee) return <PullToRefresh><WorkspaceHeader profile={profile} pathname={pathname} isEmployee logout={logout} /><NativeAppSetup />{children}</PullToRefresh>;
  return <BillingStatusProvider><CustomerWorkspace pathname={pathname} isPolicyPublic={isPolicyPublic} profile={profile} logout={logout}>{children}</CustomerWorkspace></BillingStatusProvider>;
}
