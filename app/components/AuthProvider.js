"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";

const AuthContext = createContext(null);
const ADMIN_CLIENT_STORAGE_KEY = "arkOcmAdminClientId";

function cleanClientId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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
      // Login has already been validated by the server and the custom token contains
      // the assigned role/clientId. Do not mark a valid account incomplete merely
      // because browser-side Firestore rules have not been deployed yet.
      console.warn("Unable to read account profile directly from Firestore; using verified token claims", accountError);
    }

    const role = tokenResult.claims.role || account.role || "customer";
    const clientId = cleanClientId(tokenResult.claims.clientId || account.clientId || "");
    const status = account.status || (role === "admin" || clientId ? "active" : "");
    const nextProfile = {
      ...account,
      uid: nextUser.uid,
      email: nextUser.email,
      accountEmail: account.accountEmail || nextUser.email || "",
      role,
      clientId,
      status,
      paymentSetupStatus: account.paymentSetupStatus || (clientId ? "complete" : ""),
      termsAccepted: account.termsAccepted === true || tokenResult.claims.termsAccepted === true,
      privacyAccepted: account.privacyAccepted === true || tokenResult.claims.privacyAccepted === true,
      termsVersion: account.termsVersion || String(tokenResult.claims.termsVersion || ""),
      privacyVersion: account.privacyVersion || String(tokenResult.claims.privacyVersion || ""),
    };

    let nextActiveClientId = clientId;
    if (role === "admin" && typeof window !== "undefined") {
      nextActiveClientId = cleanClientId(window.localStorage.getItem(ADMIN_CLIENT_STORAGE_KEY)) || clientId;
      if (nextActiveClientId) window.localStorage.setItem(ADMIN_CLIENT_STORAGE_KEY, nextActiveClientId);
    }

    setProfile(nextProfile);
    setActiveClientId(nextActiveClientId);
    return nextProfile;
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
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
        setProfile({
          uid: nextUser.uid,
          email: nextUser.email,
          accountEmail: nextUser.email || "",
          role: "customer",
          clientId: "",
          status: "",
          paymentSetupStatus: "",
          termsAccepted: false,
          privacyAccepted: false,
          termsVersion: "",
          privacyVersion: "",
        });
        setActiveClientId("");
      } finally {
        setLoading(false);
      }
    });
  }, [loadProfile]);

  const login = useCallback(async (identifier, password) => {
    const response = await fetch("/api/auth/business-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await readApiJson(response, "Unable to sign in.");
    return signInWithCustomToken(auth, data.token);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const selectClientId = useCallback((value) => {
    const requestedClientId = cleanClientId(value);
    const nextClientId = profile?.role === "admin"
      ? requestedClientId || cleanClientId(profile?.clientId)
      : cleanClientId(profile?.clientId);

    setActiveClientId((current) => current === nextClientId ? current : nextClientId);
    if (profile?.role === "admin" && nextClientId && typeof window !== "undefined") {
      window.localStorage.setItem(ADMIN_CLIENT_STORAGE_KEY, nextClientId);
    }
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

  const value = useMemo(
    () => ({
      user,
      profile,
      activeClientId,
      loading,
      login,
      logout,
      refreshProfile,
      selectClientId,
      isAdmin: profile?.role === "admin",
    }),
    [user, profile, activeClientId, loading, login, logout, refreshProfile, selectClientId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
