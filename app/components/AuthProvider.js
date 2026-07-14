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

    const [tokenResult, accountSnapshot] = await Promise.all([
      nextUser.getIdTokenResult(true),
      getDoc(doc(db, "accounts", nextUser.uid)),
    ]);
    const account = accountSnapshot.exists() ? accountSnapshot.data() : {};
    const nextProfile = {
      ...account,
      uid: nextUser.uid,
      email: nextUser.email,
      role: tokenResult.claims.role || account.role || "customer",
      clientId: tokenResult.claims.clientId || account.clientId || "",
      status: account.status || "",
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
          role: "customer",
          clientId: "",
          status: "",
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
