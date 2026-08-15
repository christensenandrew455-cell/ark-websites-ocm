"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import SettingsPanel from "../components/SettingsPanel";
import { useAuth } from "../components/AuthProvider";

export default function SettingsPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();

  useEffect(() => {
    if (!loading && isAdmin) router.replace("/");
  }, [isAdmin, loading, router]);

  if (loading || isAdmin) {
    return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Opening dashboard…</main>;
  }

  return <SettingsPanel />;
}
