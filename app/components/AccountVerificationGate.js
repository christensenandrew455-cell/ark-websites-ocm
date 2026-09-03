"use client";

import { signInWithCustomToken, signOut } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { readApiJson } from "../lib/apiResponse";
import { useAuth } from "./AuthProvider";

function secondsUntil(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 1000)) : 0;
}

function formatRemaining(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function editablePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function verifiedDestination(status) {
  if (status?.verified !== true) return "";
  if (status.accountStatus === "pending_business_setup") return "/setup/business";
  if (status.accountStatus === "pending_personalization") return "/setup/personalization";
  if (status.accountStatus === "pending_payment") return "/signup/payment";
  if (status.accountStatus === "active") return "/";
  return "";
}

function accountNotVerifiedMessage(error) {
  const detail = String(error?.message || "").trim();
  if (detail.startsWith("Account not verified.")) return detail;
  const reason = detail && detail !== "Something went wrong. Reload and try again." ? ` ${detail}` : "";
  return `Account not verified.${reason} Make sure your email, phone number, and newest codes are correct, then try again.`;
}

function pause(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function AccountVerificationGate() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transition, setTransition] = useState("idle");
  const [wait, setWait] = useState(0);
  const [deadlineWait, setDeadlineWait] = useState(null);

  const request = useCallback(async (body) => {
    const token = await user.getIdToken(true);
    const response = await fetch("/api/account/verification", {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    return readApiJson(response, "Something went wrong. Reload and try again.");
  }, [user]);

  const continueAfterVerification = useCallback(async (next) => {
    const destination = verifiedDestination(next);
    if (!destination) throw new Error("Account not verified. The server did not confirm both verification steps.");
    setTransition("verified");
    await pause(700);
    if (next.continuationToken) {
      try {
        await signInWithCustomToken(auth, next.continuationToken);
      } catch {
        await user.getIdToken(true);
      }
    } else {
      await user.getIdToken(true);
    }
    window.dispatchEvent(new Event("ark-account-verified"));
    window.location.replace(destination);
  }, [user]);

  useEffect(() => {
    let active = true;
    request().then(async (next) => {
      if (!active) return;
      setStatus(next);
      if (next?.verified === true) await continueAfterVerification(next);
    }).catch((loadError) => {
      if (!active) return;
      setTransition("idle");
      setError(accountNotVerifiedMessage(loadError));
    });
    return () => { active = false; };
  }, [continueAfterVerification, request]);

  useEffect(() => {
    const tick = () => setWait(secondsUntil(status?.resendAvailableAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [status?.resendAvailableAt]);

  useEffect(() => {
    if (!status?.deadlineAt) return setDeadlineWait(null);
    const tick = () => setDeadlineWait(secondsUntil(status.deadlineAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [status?.deadlineAt]);

  const expired = !status?.verified && (status?.expired === true || (Boolean(status?.deadlineAt) && deadlineWait === 0));
  const checking = transition === "checking";
  const verified = transition === "verified" || status?.verified === true;

  async function verify(event) {
    event.preventDefault();
    if (!/^\d{4}$/.test(emailCode) || (status?.phoneRequired && !/^\d{4}$/.test(phoneCode))) {
      return setError(status?.phoneRequired ? "Enter both four-digit codes." : "Enter the four-digit email code.");
    }
    setBusy(true);
    setTransition("checking");
    setError("");
    setNotice("");
    try {
      const next = await request({ action: "verify", emailCode, phoneCode });
      if (!verifiedDestination(next)) throw new Error("Account not verified. The server did not confirm both verification steps.");
      setStatus(next);
      await continueAfterVerification(next);
    } catch (verifyError) {
      setTransition("idle");
      setError(accountNotVerifiedMessage(verifyError));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setStatus(await request({ action: "resend" }));
      setEmailCode("");
      setPhoneCode("");
    } catch (resendError) {
      setError(resendError.message);
    } finally {
      setBusy(false);
    }
  }

  function beginContactEdit() {
    setEditEmail(status?.editableEmail || "");
    setEditPhone(editablePhone(status?.editablePhone));
    setEditingContact(true);
    setError("");
    setNotice("");
  }

  function cancelContactEdit() {
    setEditingContact(false);
    setError("");
  }

  async function saveContact(event) {
    event.preventDefault();
    const email = editEmail.trim().toLowerCase();
    const phone = editablePhone(editPhone);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (!/^\d{10}$/.test(phone)) return setError("Enter a valid 10-digit U.S. phone number.");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request({ action: "update-contact", email, phone });
      setStatus(next);
      setEmailCode("");
      setPhoneCode("");
      setEditingContact(false);
      setNotice("Contact details updated. We sent fresh verification codes.");
    } catch (updateError) {
      setError(updateError.message);
      try {
        const latest = await request();
        setStatus(latest);
        if (latest.editableEmail === email && editablePhone(latest.editablePhone) === phone) setEditingContact(false);
      } catch {
        // Keep the delivery or validation error that explains what the owner should do next.
      }
    } finally {
      setBusy(false);
    }
  }

  return <main className="ark-auth-page fixed inset-0 z-[200] grid min-h-screen place-items-center overflow-y-auto px-4 py-8">
    <section className="ark-auth-card w-full max-w-md rounded-[2rem] p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true" aria-labelledby="verification-title">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 2 of 5 · Verify</p>
      <h1 id="verification-title" className="mt-2 text-3xl font-black tracking-tight">{expired ? "Verification time expired" : checking ? "Checking your account" : verified ? "Account verified" : editingContact ? "Correct your contact details" : status?.phoneRequired ? "Verify your email and phone" : "Verify your email"}</h1>
      {!expired && !checking && !verified && deadlineWait !== null && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900" role="status">Finish both verifications within {formatRemaining(deadlineWait)} or this signup will be canceled and its saved information deleted.</p>}
      {checking ? <div className="py-10 text-center" role="status" aria-live="polite">
        <span className="mx-auto block h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-700" aria-hidden="true" />
        <p className="mt-5 text-sm font-bold text-slate-600">Checking both codes with the server…</p>
      </div> : expired ? <>
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold leading-6 text-red-800" role="alert">The one-hour verification window ended. This signup is locked and scheduled for permanent deletion. Sign out and start signup again.</p>
      </> : verified ? <div className="py-8 text-center" role="status" aria-live="polite">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 4 4L19 6" /></svg>
        </span>
        <p className="mt-5 text-sm font-bold text-slate-600">Opening your business information…</p>
      </div> : editingContact ? <>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Update a typo here. Saving will make the old codes stop working and send fresh codes to both entries.</p>
        <form onSubmit={saveContact} className="mt-6 space-y-4">
          <label className="block"><span className="text-xs font-black text-slate-800">Email address</span><input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value.slice(0, 254))} autoComplete="email" className="mt-2 h-13 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-indigo-700" /></label>
          <label className="block"><span className="text-xs font-black text-slate-800">Phone number</span><input type="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="tel" autoComplete="tel" placeholder="7742316164" className="mt-2 h-13 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-indigo-700" /></label>
          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-3"><button type="button" onClick={cancelContactEdit} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-40">Cancel</button><button type="submit" disabled={busy} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy ? "Saving…" : "Save & Send Codes"}</button></div>
        </form>
      </> : <>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{status?.phoneRequired ? "We sent separate four-digit codes to your email and phone. Enter both before using the client center." : "We sent a four-digit code to your email. Enter it before using the client center."}</p>
        <form onSubmit={verify} className="mt-6 space-y-4">
          <label className="block"><span className="text-xs font-black text-slate-800">Email code · {status?.email || "your email"}</span><input value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000" className="mt-2 h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-center text-2xl font-black tracking-[0.35em] outline-none focus:border-indigo-700" /></label>
          {status?.phoneRequired && <label className="block"><span className="text-xs font-black text-slate-800">Text code · {status?.phone || "your phone"}</span><input value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" placeholder="0000" className="mt-2 h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-center text-2xl font-black tracking-[0.35em] outline-none focus:border-indigo-700" /></label>}
          {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800" role="status">{notice}</p>}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700" role="alert">{error}</p>}
          {(status?.emailDeliveryStatus === "failed" || (status?.phoneRequired && status?.phoneDeliveryStatus === "failed")) && !error && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">The code may not have arrived. Use Resend Code below.</p>}
          <button type="submit" disabled={busy || emailCode.length !== 4 || (status?.phoneRequired && phoneCode.length !== 4)} className="h-13 w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white disabled:opacity-40">{busy ? "Checking…" : status?.phoneRequired ? "Submit Codes" : "Submit Code"}</button>
        </form>
        <button type="button" onClick={resend} disabled={busy || wait > 0} className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-black text-slate-700 disabled:opacity-40">{wait > 0 ? `Resend ${status?.phoneRequired ? "Codes" : "Code"} in ${wait}s` : `Resend ${status?.phoneRequired ? "Codes" : "Code"}`}</button>
        <button type="button" onClick={beginContactEdit} disabled={busy || !status} className="mt-3 w-full px-5 py-2 text-xs font-black text-indigo-700 underline disabled:opacity-40">Edit email or phone</button>
      </>}
      <button type="button" onClick={() => signOut(auth)} className="mt-5 w-full text-xs font-bold text-slate-500 underline">Sign out</button>
    </section>
  </main>;
}
