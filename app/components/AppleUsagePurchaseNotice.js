"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useBillingStatus } from "./BillingStatusProvider";
import { readApiJson } from "../lib/apiResponse";
import {
  appleIapAvailable,
  appleProducts,
  finishAppleTransaction,
  purchaseWithApple,
  unfinishedAppleTransactions,
} from "../lib/appleIapClient";

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

export default function AppleUsagePurchaseNotice() {
  const { user, profile } = useAuth();
  const { refresh: refreshBillingStatus } = useBillingStatus();
  const [nativeApple, setNativeApple] = useState(false);
  const [summary, setSummary] = useState(null);
  const [configuration, setConfiguration] = useState(null);
  const [displayPrice, setDisplayPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const resumedTransactionIds = useRef(new Set());

  useEffect(() => { setNativeApple(appleIapAvailable()); }, []);

  const load = useCallback(async () => {
    if (!user || profile?.billingProvider !== "apple") return;
    setLoading(true);
    try {
      const token = await user.getIdToken(true);
      const summaryResponse = await fetch("/api/billing/usage-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const usage = await readApiJson(summaryResponse, "Could not check Apple usage billing.");
      setSummary(usage);
      if (usage.usagePurchaseRequired || nativeApple) {
        const configResponse = await fetch("/api/billing/apple/configuration", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const config = await readApiJson(configResponse, "Could not open Apple usage billing.");
        setConfiguration(config);
        if (nativeApple && usage.usagePurchaseRequired) {
          const products = await appleProducts([config.usageProduct.productId]);
          setDisplayPrice((products.products || []).find((item) => item.id === config.usageProduct.productId)?.displayPrice || "");
        } else {
          setDisplayPrice("");
        }
      } else {
        setConfiguration(null);
        setDisplayPrice("");
      }
      setError("");
    } catch (loadError) {
      console.error("Unable to load Apple usage purchase", loadError);
      setError(String(loadError?.message || "Could not check Apple usage billing."));
    } finally {
      setLoading(false);
    }
  }, [nativeApple, profile?.billingProvider, user]);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 60 * 1000);
    const refresh = () => load();
    window.addEventListener("ark:billing-refresh", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("ark:billing-refresh", refresh);
    };
  }, [load]);

  const verifyAndFinish = useCallback(async (purchase) => {
    const token = await user.getIdToken(true);
    const response = await fetch("/api/billing/apple/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signedTransaction: purchase.signedTransaction }),
    });
    await readApiJson(response, "Apple could not verify this usage purchase.");
    await finishAppleTransaction(purchase.transactionId).catch((finishError) => console.warn("Apple will retry transaction completion", finishError));
    await Promise.all([load(), refreshBillingStatus()]);
  }, [load, refreshBillingStatus, user]);

  useEffect(() => {
    if (!nativeApple || !configuration?.productIds?.length) return;
    const resume = async () => {
      try {
        const result = await unfinishedAppleTransactions(configuration.productIds);
        for (const purchase of result.transactions || []) {
          if (resumedTransactionIds.current.has(purchase.transactionId)) continue;
          resumedTransactionIds.current.add(purchase.transactionId);
          try {
            await verifyAndFinish(purchase);
          } catch (error) {
            resumedTransactionIds.current.delete(purchase.transactionId);
            throw error;
          }
        }
      } catch (resumeError) {
        console.warn("Unable to resume unfinished Apple usage purchase", resumeError);
      }
    };
    resume();
    const interval = window.setInterval(resume, 15 * 1000);
    return () => window.clearInterval(interval);
  }, [configuration?.productIds, nativeApple, verifyAndFinish]);

  async function purchaseUsage() {
    if (!configuration || purchasing) return;
    setPurchasing(true); setNotice(""); setError("");
    try {
      const purchase = await purchaseWithApple({
        productId: configuration.usageProduct.productId,
        appAccountToken: configuration.appAccountToken,
      });
      if (purchase.status === "cancelled") { setNotice("The Apple purchase was canceled. No charge was made."); return; }
      if (purchase.status === "pending") { setNotice("Apple is reviewing this purchase. Usage will be applied after approval."); return; }
      await verifyAndFinish(purchase);
      setNotice("Apple usage purchase complete.");
    } catch (purchaseError) {
      console.error("Apple usage purchase failed", purchaseError);
      setError(String(purchaseError?.message || "The Apple usage purchase could not be completed."));
      await load();
    } finally {
      setPurchasing(false);
    }
  }

  if (profile?.billingProvider !== "apple" || !summary?.usagePurchaseRequired) return null;
  const price = displayPrice || money(summary.appleUsageAmountCents || configuration?.usageProduct?.amountCents || 2000);
  const purchaseDiscount = Number(configuration?.referralDiscountPercent ?? summary.referralDiscountPercent ?? 0);
  return <section className="border-b border-indigo-200 bg-indigo-50 px-3 py-4" aria-labelledby="apple-usage-title">
    <div className="mx-auto max-w-6xl rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-5">
      <div>
        <h2 id="apple-usage-title" className="text-base font-black text-indigo-950">Your next usage interval is ready to purchase</h2>
        <p className="mt-1 text-xs font-semibold leading-5 text-indigo-800">Your usage reached {money(summary.usageThresholdCents || 2000)}. Confirm {price} with Apple to apply the next 20 usage credits{purchaseDiscount ? `, including your ${purchaseDiscount}% referral savings` : ""}.</p>
        {!nativeApple && <p className="mt-2 text-xs font-black text-indigo-950">Open ARK Client Center on your iPhone to complete this Apple purchase.</p>}
        {notice && <p className="mt-2 text-xs font-bold text-blue-700" role="status">{notice}</p>}
        {error && <p className="mt-2 text-xs font-bold text-red-700" role="alert">{error}</p>}
      </div>
      {nativeApple && <button type="button" onClick={purchaseUsage} disabled={loading || purchasing || !configuration} className="mt-4 min-h-12 w-full rounded-xl bg-indigo-800 px-5 py-3 text-sm font-black text-white disabled:opacity-50 sm:mt-0 sm:w-auto sm:min-w-48">{purchasing ? "Confirming with Apple…" : `Purchase ${price} Usage`}</button>}
    </div>
  </section>;
}
