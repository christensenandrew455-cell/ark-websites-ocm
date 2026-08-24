"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { ownerFacingError } from "../lib/userFacingError";
import { appleIapAvailable, manageAppleSubscriptions } from "../lib/appleIapClient";

const DEFAULT_STATUS = {
  phase: "current",
  restricted: false,
  showNotice: false,
  serviceAccess: "full",
  billingProvider: "stripe",
  failureAt: "",
  retryAt: "",
  recoveryEndsAt: "",
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
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openingBilling, setOpeningBilling] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
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
      setError(ownerFacingError(refreshError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return undefined;
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
  }, [authLoading, refresh, user]);

  const openBillingPortal = useCallback(async () => {
    if (!user || openingBilling) return;
    setOpeningBilling(true);
    setError("");
    try {
      if (status.billingProvider === "apple") {
        if (appleIapAvailable()) await manageAppleSubscriptions();
        else window.location.assign("https://apps.apple.com/account/subscriptions");
        setOpeningBilling(false);
        return;
      }
      if (appleIapAvailable()) throw new Error("Billing changes for this existing account are not available inside the iPhone app.");
      const token = await user.getIdToken(true);
      const response = await fetch("/api/billing/create-portal-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open secure billing settings.");
      window.location.assign(data.url);
    } catch (billingError) {
      setError(ownerFacingError(billingError));
      setOpeningBilling(false);
    }
  }, [openingBilling, status.billingProvider, user]);

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
