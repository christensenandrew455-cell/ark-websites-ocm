"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { ACCOUNT_TYPES } from "../lib/accountTypes";
import { ACCOUNT_ROLES, isStandardRole } from "../lib/accountRoles";
import { auth, db } from "../lib/firebase";
import { availableAccountFeatures } from "../lib/launchFeatures";
import { readApiJson } from "../lib/apiResponse";
import { normalizeClientId } from "../lib/valueUtils";

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
    const claimedRole = String(tokenResult.claims.role || "");
    if (!isStandardRole(claimedRole)) throw new Error("OWNER_ACCOUNT_REQUIRED");
    const claimedClientId = normalizeClientId(tokenResult.claims.clientId || tokenResult.claims.businessClientId || "");
    const accountDocumentId = claimedClientId || nextUser.uid;
    let account = {};
    try {
      const snapshot = await getDoc(doc(db, "accounts", accountDocumentId));
      account = snapshot.exists() ? snapshot.data() : {};
    } catch (accountError) {
      console.warn("Unable to read account profile directly from Firestore; using verified token claims", accountError);
    }

    const role = tokenResult.claims.role || account.role || ACCOUNT_ROLES.STANDARD;
    if (!isStandardRole(role)) throw new Error("OWNER_ACCOUNT_REQUIRED");
    const clientId = normalizeClientId(claimedClientId || account.clientId || "");
    const claimedStatus = String(tokenResult.claims.accountStatus || "");
    const status = account.status || claimedStatus || (clientId ? "active" : "");
    const accountType = account.accountType || String(tokenResult.claims.accountType || "") || ACCOUNT_TYPES.OWNER;
    const availableFeatures = availableAccountFeatures({
      messagesEnabled: account.messagesEnabled === true || tokenResult.claims.messagesEnabled === true,
    });
    const nextProfile = {
      ...account,
      uid: nextUser.uid,
      email: nextUser.email,
      accountEmail: account.accountEmail || nextUser.email || "",
      role,
      accountType,
      businessRole: account.businessRole || String(tokenResult.claims.businessRole || "owner"),
      clientId,
      status,
      ...availableFeatures,
      paymentSetupStatus: account.paymentSetupStatus || (status === "active" ? "complete" : ""),
      identityVerificationRequired: account.identityVerificationRequired === true || tokenResult.claims.identityVerificationRequired === true,
      identityVerificationVerified: account.identityVerificationVerified === true || tokenResult.claims.identityVerificationVerified === true,
      identityVerificationStatus: account.identityVerificationStatus || "",
      emailVerificationStatus: account.emailVerificationStatus || "",
      phoneVerificationStatus: account.phoneVerificationStatus || "",
      onboardingTourStatus: account.onboardingTourStatus || "",
      numberAssignmentStatus: account.numberAssignmentStatus || "",
      termsAccepted: account.termsAccepted === true || tokenResult.claims.termsAccepted === true,
      privacyAccepted: account.privacyAccepted === true || tokenResult.claims.privacyAccepted === true,
      termsVersion: account.termsVersion || String(tokenResult.claims.termsVersion || ""),
      privacyVersion: account.privacyVersion || String(tokenResult.claims.privacyVersion || ""),
    };
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (nextUser) => {
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
      console.error("Unable to load owner account profile", error);
      await signOut(auth).catch((signOutError) => console.warn("Unable to clear the expired local sign-in", signOutError));
      setUser(null);
      setProfile(null);
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
    loading,
    login,
    logout,
    refreshProfile,
    isOwner: isStandardRole(profile?.role),
    isBusinessOwner: isStandardRole(profile?.role),
  }), [user, profile, loading, login, logout, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
