"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import NativeAppSetup from "./NativeAppSetup";

const DEFAULT_CLIENT_ID = "tabor-painting";
const PUBLIC_PATHS = ["/login", "/signup", "/signup/complete", "/forgot-password", "/terms", "/privacy"];
const ADMIN_NAV_ITEMS = [
  { label: "Dashboard", mobileLabel: "Dash", href: "/" },
  { label: "Messages", mobileLabel: "Messages", href: "/messages" },
  { label: "Connections", mobileLabel: "Accounts", href: "/connections" },
  { label: "Settings", mobileLabel: "Settings", href: "/settings" },
];

function LoadingScreen({ message = "Loading client center…" }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-sm font-semibold text-slate-600 shadow-sm">
        {message}
      </div>
    </main>
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, isAdmin, loading, logout, selectClientId } = useAuth();
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const selectedClientId = profile?.clientId || DEFAULT_CLIENT_ID;

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

    if (user && !isPublic) selectClientId(selectedClientId);
  }, [isAdmin, isPublic, loading, pathname, router, selectClientId, selectedClientId, user]);

  if (loading) return <LoadingScreen />;
  if (isPublic) return children;
  if (!user) return <LoadingScreen />;

  const signOutButton = (
    <button
      type="button"
      onClick={logout}
      className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-950 sm:text-sm"
    >
      Sign out
    </button>
  );

  if (isAdmin) {
    return (
      <>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur md:px-8 md:py-4">
          <div className="mx-auto flex max-w-7xl flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0 leading-tight">
                <p className="truncate text-base font-black tracking-tight text-slate-950 sm:text-xl">ARK Client Center</p>
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:text-xs">Admin</p>
              </div>
              <div className="sm:hidden">{signOutButton}</div>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <nav
                className="grid min-w-0 flex-1 gap-1 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-none"
                style={{ gridTemplateColumns: `repeat(${ADMIN_NAV_ITEMS.length}, minmax(0, 1fr))` }}
              >
                {ADMIN_NAV_ITEMS.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active
                        ? "min-w-0 rounded-lg bg-white px-1 py-2 text-center text-[9px] font-black text-slate-950 shadow-sm sm:whitespace-nowrap sm:px-3 sm:text-sm"
                        : "min-w-0 rounded-lg px-1 py-2 text-center text-[9px] font-bold text-slate-600 hover:bg-white/60 hover:text-slate-950 sm:whitespace-nowrap sm:px-3 sm:text-sm"}
                    >
                      <span className="sm:hidden">{item.mobileLabel}</span>
                      <span className="hidden sm:inline">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="hidden sm:block">{signOutButton}</div>
            </div>
          </div>
        </header>
        <NativeAppSetup />
        {children}
      </>
    );
  }

  const settingsActive = pathname.startsWith("/settings");
  const accountLabel = profile?.businessName || "Tabor Painting";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur sm:px-5 md:px-8 md:py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <p className="truncate text-lg font-black tracking-tight text-slate-950 sm:text-2xl">ARK Client Center</p>
            <p className="mt-0.5 truncate text-xs font-bold uppercase tracking-[0.12em] text-slate-500 sm:text-sm">{accountLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {signOutButton}
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className={settingsActive
                ? "grid h-10 w-10 place-items-center rounded-lg bg-slate-950 text-white shadow-sm sm:h-11 sm:w-11"
                : "grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950 sm:h-11 sm:w-11"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.5 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.08A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.12.6.65 1.03 1.26 1.03H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>
      <NativeAppSetup />
      {children}
    </>
  );
}
