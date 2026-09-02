"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

const AppleIAP = registerPlugin("AppleIAP");

export function appleIapAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function appleProducts(productIds) {
  if (!appleIapAvailable()) throw new Error("Apple purchases are available in the iPhone app.");
  return AppleIAP.getProducts({ productIds });
}

export async function purchaseWithApple({ productId, appAccountToken, quantity = 1 }) {
  if (!appleIapAvailable()) throw new Error("Apple purchases are available in the iPhone app.");
  return AppleIAP.purchase({ productId, appAccountToken, quantity });
}

export async function currentAppleEntitlements(productIds) {
  if (!appleIapAvailable()) return { transactions: [] };
  return AppleIAP.currentEntitlements({ productIds });
}

export async function unfinishedAppleTransactions(productIds) {
  if (!appleIapAvailable()) return { transactions: [] };
  return AppleIAP.unfinishedTransactions({ productIds });
}

export async function finishAppleTransaction(transactionId) {
  if (!appleIapAvailable()) return { finished: false };
  return AppleIAP.finish({ transactionId });
}

export async function restoreApplePurchases(productIds) {
  if (!appleIapAvailable()) throw new Error("Apple purchases are available in the iPhone app.");
  return AppleIAP.restorePurchases({ productIds });
}

export async function manageAppleSubscriptions() {
  if (!appleIapAvailable()) throw new Error("Open the iPhone app to manage your Apple subscription.");
  return AppleIAP.manageSubscriptions();
}
