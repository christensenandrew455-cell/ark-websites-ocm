"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";

const DEFAULT_STATUS = {
  phase: "current",
  restricted: false,
  showNotice: false,
  serviceAccess: "full",
  offenseNumber: 0,
  amountDue: 0,
  currency: "usd",
  graceEndsAt: "",
  reviewAt: "",
};

const BillingStatusContext = createContext({
  status: DEFAULT_STATUS,
  loading: false,
  error: "",
  refresh: async () => DEFAULT_STATUS,
  openBillingPortal: async () => {},
  openingBilling: false,
});

export function BillingStatusProvider({ children }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openingBilling, setOpeningBilling] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || isAdmin) {
      setStatus(DEFAULT_STATUS);
      return DEFAULT_STATUS;
    }

    setLoading(true);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not check payment status.");
      const nextStatus = { ...DEFAULT_STATUS, ...(data.status || {}) };
      setStatus(nextStatus);
      setError("");
      return nextStatus;
    } catch (refreshError) {
      console.error("Unable to refresh billing status", refreshError);
      setError(refreshError.message || "Could not check payment status.");
      return status;
    } finally {
      setLoading(false);
    }
  }, [isAdmin, status, user]);

  useEffect(() => {
    if (authLoading || !user || isAdmin) return undefined;
    refresh();
    const interval = window.setInterval(refresh, 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authLoading, isAdmin, refresh, user]);

  const openBillingPortal = useCallback(async () => {
    if (!user || openingBilling) return;
    setOpeningBilling(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/create-portal-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open secure billing settings.");
      window.location.assign(data.url);
    } catch (billingError) {
      setError(billingError.message || "Could not open secure billing settings.");
      setOpeningBilling(false);
    }
  }, [openingBilling, user]);

  const value = useMemo(() => ({
    status,
    loading,
    error,
    refresh,
    openBillingPortal,
    openingBilling,
  }), [error, loading, openBillingPortal, openingBilling, refresh, status]);

  return <BillingStatusContext.Provider value={value}>{children}</BillingStatusContext.Provider>;
}

export function useBillingStatus() {
  return useContext(BillingStatusContext);
}
