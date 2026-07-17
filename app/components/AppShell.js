"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

const DEFAULT_CLIENT_ID = "tabor-painting";
const PUBLIC_PATHS = ["/login", "/signup", "/signup/complete", "/forgot-password"];
const CUSTOMER_NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Review My Clients", href: "/review-my-clients" },
  { label: "Settings", href: "/settings" },
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
    ? [{ label: "Customer Setup", href: "/connections" }, ...CUSTOMER_NAV_ITEMS]
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
  const subtitle = isAdmin
    ? "Create customers and configure AI receptionists"
    : "Powered by the AI receptionist";

  return (
    <>
      <header className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-black tracking-tight text-slate-950">{title}</p>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{subtitle}</p>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <nav className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              {navItems.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={active
                      ? "whitespace-nowrap rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-950 shadow-sm"
                      : "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:text-slate-950"}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={logout}
              className="whitespace-nowrap px-2 py-2 text-sm font-semibold text-slate-500 hover:text-slate-950"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
