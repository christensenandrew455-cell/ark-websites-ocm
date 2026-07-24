"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { ACCOUNT_TYPES } from "../lib/accountTypes";
import { auth, db } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { normalizeClientId } from "../lib/valueUtils";

const AuthContext = createContext(null);
const ADMIN_CLIENT_STORAGE_KEY = "arkOcmAdminClientId";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeClientId, setActiveClientId] = useState("");
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (nextUser) => {
    if (!nextUser) {
      setProfile(null);
      setActiveClientId("");
      return null;
    }

    const tokenResult = await nextUser.getIdTokenResult(true);
    let account = {};
    try {
      const accountSnapshot = await getDoc(doc(db, "accounts", nextUser.uid));
      account = accountSnapshot.exists() ? accountSnapshot.data() : {};
    } catch (accountError) {
      console.warn("Unable to read account profile directly from Firestore; using verified token claims", accountError);
    }

    const role = tokenResult.claims.role || account.role || "customer";
    const clientId = normalizeClientId(tokenResult.claims.clientId || tokenResult.claims.businessClientId || account.clientId || "");
    const claimedStatus = String(tokenResult.claims.accountStatus || "");
    const status = account.status || claimedStatus || (role === "admin" || (clientId && !claimedStatus) ? "active" : "");
    const billingPlan = "standard";
    const accountType = account.accountType || String(tokenResult.claims.accountType || "") || (role === "employee" ? ACCOUNT_TYPES.EMPLOYEE : ACCOUNT_TYPES.OWNER);
    const businessRole = account.businessRole || String(tokenResult.claims.businessRole || (role === "employee" ? "employee" : "owner"));

    const nextProfile = {
      ...account,
      uid: nextUser.uid,
      email: nextUser.email,
      accountEmail: account.accountEmail || nextUser.email || "",
      role,
      accountType,
      businessRole,
      billingPlan,
      clientId,
      status,
      messagesEnabled: account.messagesEnabled === true || tokenResult.claims.messagesEnabled === true,
      employeesEnabled: account.employeesEnabled === true || tokenResult.claims.employeesEnabled === true,
      employeeMessagingEnabled: account.employeeMessagingEnabled === true || tokenResult.claims.employeeMessagingEnabled === true,
      paymentSetupStatus: account.paymentSetupStatus || (status === "active" && role !== "employee" ? "complete" : ""),
      termsAccepted: account.termsAccepted === true || tokenResult.claims.termsAccepted === true,
      privacyAccepted: account.privacyAccepted === true || tokenResult.claims.privacyAccepted === true,
      termsVersion: account.termsVersion || String(tokenResult.claims.termsVersion || ""),
      privacyVersion: account.privacyVersion || String(tokenResult.claims.privacyVersion || ""),
    };

    let nextActiveClientId = clientId;
    if (role === "admin" && typeof window !== "undefined") {
      nextActiveClientId = normalizeClientId(window.localStorage.getItem(ADMIN_CLIENT_STORAGE_KEY)) || clientId;
      if (nextActiveClientId) window.localStorage.setItem(ADMIN_CLIENT_STORAGE_KEY, nextActiveClientId);
    }

    setProfile(nextProfile);
    setActiveClientId(nextActiveClientId);
    return nextProfile;
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (nextUser) => {
    setLoading(true);
    setUser(nextUser);
    setProfile(null);
    if (!nextUser) {
      setActiveClientId("");
      setLoading(false);
      return;
    }
    try {
      await loadProfile(nextUser);
    } catch (error) {
      console.error("Unable to load account profile", error);
      setProfile({ uid: nextUser.uid, email: nextUser.email, accountEmail: nextUser.email || "", role: "customer", accountType: ACCOUNT_TYPES.OWNER, businessRole: "owner", billingPlan: "standard", clientId: "", status: "", messagesEnabled: false, employeesEnabled: false, employeeMessagingEnabled: false, paymentSetupStatus: "", termsAccepted: false, privacyAccepted: false, termsVersion: "", privacyVersion: "" });
      setActiveClientId("");
    } finally {
      setLoading(false);
    }
  }), [loadProfile]);

  const login = useCallback(async (identifier, password, options = {}) => {
    const response = await fetch("/api/auth/business-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password, loginMode: options.loginMode || "owner", personName: options.personName || "" }),
    });
    const data = await readApiJson(response, "Unable to sign in.");
    return signInWithCustomToken(auth, data.token);
  }, []);

  const logout = useCallback(async () => signOut(auth), []);

  const selectClientId = useCallback((value) => {
    const requestedClientId = normalizeClientId(value);
    const nextClientId = profile?.role === "admin" ? requestedClientId || normalizeClientId(profile?.clientId) : normalizeClientId(profile?.clientId);
    setActiveClientId((current) => current === nextClientId ? current : nextClientId);
    if (profile?.role === "admin" && nextClientId && typeof window !== "undefined") window.localStorage.setItem(ADMIN_CLIENT_STORAGE_KEY, nextClientId);
    return nextClientId;
  }, [profile?.clientId, profile?.role]);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return null;
    setLoading(true);
    try {
      return await loadProfile(auth.currentUser);
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  const value = useMemo(() => ({
    user,
    profile,
    activeClientId,
    loading,
    login,
    logout,
    refreshProfile,
    selectClientId,
    isAdmin: profile?.role === "admin",
    isEmployee: profile?.role === "employee" || profile?.accountType === ACCOUNT_TYPES.EMPLOYEE,
    isOwner: profile?.role === "customer" && profile?.accountType !== ACCOUNT_TYPES.EMPLOYEE,
    isBusinessOwner: profile?.role === "customer" && profile?.accountType !== ACCOUNT_TYPES.EMPLOYEE,
  }), [user, profile, activeClientId, loading, login, logout, refreshProfile, selectClientId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
