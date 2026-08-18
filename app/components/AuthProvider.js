"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { isStandardRole } from "../lib/accountRoles";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");

  const loadProfile = useCallback(async (nextUser) => {
    if (!nextUser) {
      setProfile(null);
      setProfileError("");
      return null;
    }

    const token = await nextUser.getIdToken(true);
    const response = await fetch("/api/account/profile", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    let data;
    try {
      data = await readApiJson(response, "Could not load your account information.");
    } catch (error) {
      error.status = response.status;
      throw error;
    }
    const nextProfile = data.profile;
    if (!nextProfile?.clientId) throw new Error("Could not load your business account.");
    setProfile(nextProfile);
    setProfileError("");
    return nextProfile;
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (nextUser) => {
    setLoading(true);
    setUser(nextUser);
    setProfile(null);
    setProfileError("");
    if (!nextUser) {
      setLoading(false);
      return;
    }
    try {
      await loadProfile(nextUser);
    } catch (error) {
      console.error("Unable to load owner account profile", error);
      if ([401, 403, 404, 410].includes(Number(error?.status))) {
        await signOut(auth).catch((signOutError) => console.warn("Unable to clear the expired local sign-in", signOutError));
        setUser(null);
        setProfile(null);
        setProfileError("");
        setLoading(false);
        return;
      }
      setProfile(null);
      setProfileError("We couldn’t load your account information. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }), [loadProfile]);

  const login = useCallback(async (identifier, password) => {
    const response = await fetch("/api/auth/business-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await readApiJson(response, "Unable to sign in.");
    return signInWithCustomToken(auth, data.token);
  }, []);

  const logout = useCallback(async () => signOut(auth), []);
  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return null;
    try {
      return await loadProfile(auth.currentUser);
    } catch (error) {
      console.error("Unable to refresh owner account profile", error);
      setProfileError("We couldn’t load your account information. Check your connection and try again.");
      return null;
    }
  }, [loadProfile]);
  const updateProfile = useCallback((updates) => {
    setProfile((current) => {
      if (!current) return current;
      const patch = typeof updates === "function" ? updates(current) : updates;
      return { ...current, ...(patch || {}) };
    });
  }, []);

  const value = useMemo(() => ({
    user,
    profile,
    profileError,
    loading,
    login,
    logout,
    refreshProfile,
    updateProfile,
    isOwner: isStandardRole(profile?.role),
    isBusinessOwner: isStandardRole(profile?.role),
  }), [user, profile, profileError, loading, login, logout, refreshProfile, updateProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
