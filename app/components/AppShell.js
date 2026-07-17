"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

const DEFAULT_CLIENT_ID = "tabor-painting";
const PUBLIC_PATHS = ["/login", "/signup", "/signup/complete", "/forgot-password"];
const CUSTOMER_NAV_ITEMS = [
  { label: "Home", mobileLabel: "Home", href: "/" },
  { label: "Review My Clients", mobileLabel: "Clients", href: "/review-my-clients" },
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
  const navItems = isAdmin
    ? [{ label: "Customer Setup", mobileLabel: "Customers", href: "/connections" }, ...CUSTOMER_NAV_ITEMS]
    : CUSTOMER_NAV_ITEMS;

  useEffect(() => {
    if (loading) return;

    if (!user && !isPublic) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (user && (pathname === "/login" || pathname === "/signup")) {
      router.replace(isAdmin ? "/connections" : "/");
      return;
    }

    if (user && !isPublic) selectClientId(selectedClientId);
  }, [isAdmin, isPublic, loading, pathname, router, selectClientId, selectedClientId, user]);

  if (loading) return <LoadingScreen />;
  if (isPublic) return children;
  if (!user) return <LoadingScreen />;

  const title = isAdmin
    ? "ARK OCM Admin"
    : `${profile?.businessName || "Tabor Painting"} Client Center`;

  const signOutButton = (
    <button
      type="button"
      onClick={logout}
      className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-950 sm:text-sm"
    >
      Sign out
    </button>
  );

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur md:px-8 md:py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="truncate text-base font-black tracking-tight text-slate-950 sm:text-lg">{title}</p>
            <div className="sm:hidden">{signOutButton}</div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <nav
              className="grid min-w-0 flex-1 gap-1 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-none"
              style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
            >
              {navItems.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={active
                      ? "min-w-0 rounded-lg bg-white px-2 py-2 text-center text-[11px] font-black text-slate-950 shadow-sm sm:whitespace-nowrap sm:px-3 sm:text-sm"
                      : "min-w-0 rounded-lg px-2 py-2 text-center text-[11px] font-bold text-slate-600 hover:bg-white/60 hover:text-slate-950 sm:whitespace-nowrap sm:px-3 sm:text-sm"}
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
      {children}
    </>
  );
}
