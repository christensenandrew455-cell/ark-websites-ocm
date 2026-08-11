"use client";

import {
  OWNER_SIGNUP_DRAFT_KEY,
  OWNER_SIGNUP_DRAFT_MAX_AGE_MS,
  normalizeOwnerSignup,
} from "./ownerSignup.js";

export function clearOwnerSignupDraft() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(OWNER_SIGNUP_DRAFT_KEY);
}

export function loadOwnerSignupDraft() {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(OWNER_SIGNUP_DRAFT_KEY) || "null");
    const savedAt = Number(value?.savedAt || 0);
    if (!value || !savedAt || Date.now() - savedAt > OWNER_SIGNUP_DRAFT_MAX_AGE_MS) {
      clearOwnerSignupDraft();
      return null;
    }
    return normalizeOwnerSignup(value, { includePassword: true });
  } catch {
    clearOwnerSignupDraft();
    return null;
  }
}

export function saveOwnerSignupDraft(value) {
  if (typeof window === "undefined") return null;
  const draft = normalizeOwnerSignup(value, { includePassword: true });
  window.sessionStorage.setItem(OWNER_SIGNUP_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  return draft;
}
