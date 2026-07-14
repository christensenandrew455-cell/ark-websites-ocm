"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

const PUBLIC_PATHS = ["/login", "/signup", "/signup/complete", "/forgot-password"];

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-sm font-semibold text-slate-600 shadow-sm">
        Loading ARK OCM…
      </div>
    </main>
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, logout, isAdmin } = useAuth();
  const [correctingClient, setCorrectingClient] = useState(false);
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

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

    if (user && profile && !isAdmin && !isPublic && pathname !== "/") {
      const assignedClientId = profile.clientId;
      if (!assignedClientId) return;

      const params = new URLSearchParams(window.location.search);
      if (params.get("clientId") !== assignedClientId) {
        setCorrectingClient(true);
        params.set("clientId", assignedClientId);
        router.replace(`${pathname}?${params.toString()}`);
      } else {
        setCorrectingClient(false);
      }
    } else {
      setCorrectingClient(false);
    }
  }, [isAdmin, isPublic, loading, pathname, profile, router, user]);

  if (loading || correctingClient) {
    return <LoadingScreen />;
  }

  if (isPublic) {
    return children;
  }

  if (!user) {
    return <LoadingScreen />;
  }

  if (!profile?.clientId && !isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold">Account setup is incomplete</h1>
          <p className="mt-3 text-slate-600">Your account is signed in, but it is not connected to a business yet.</p>
          <button
            type="button"
            onClick={logout}
            className="mt-6 rounded-lg bg-slate-950 px-5 py-3 text-sm font-bold text-white"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="relative border-b border-slate-200 bg-white px-5 py-4 shadow-sm md:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold text-slate-700 hover:text-slate-950">
            Dashboard
          </Link>
          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-lg font-bold tracking-tight text-slate-950 sm:block">
            ARK Website OCM
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                Admin
              </span>
            )}
            <button type="button" onClick={logout} className="text-sm font-semibold text-slate-600 hover:text-slate-950">
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
