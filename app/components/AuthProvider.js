"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (nextUser) => {
    if (!nextUser) {
      setProfile(null);
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
    const clientId = tokenResult.claims.clientId || account.clientId || "";
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
    };

    setProfile(nextProfile);
    return nextProfile;
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      setLoading(true);
      setUser(nextUser);
      setProfile(null);

      if (!nextUser) {
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
        });
      } finally {
        setLoading(false);
      }
    });
  }, [loadProfile]);

  async function login(identifier, password) {
    const response = await fetch("/api/auth/business-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await readApiJson(response, "Unable to sign in.");
    return signInWithCustomToken(auth, data.token);
  }

  async function logout() {
    await signOut(auth);
  }

  async function refreshProfile() {
    if (!auth.currentUser) return null;
    setLoading(true);
    try {
      return await loadProfile(auth.currentUser);
    } finally {
      setLoading(false);
    }
  }

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      login,
      logout,
      refreshProfile,
      isAdmin: profile?.role === "admin",
    }),
    [user, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
