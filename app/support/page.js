"use client";

import Link from "next/link";
import { useState } from "react";

const EMPTY_FORM = { name: "", businessName: "", email: "", subject: "", message: "", companyWebsite: "" };

export default function SupportPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/support/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Support could not be contacted.");
      setForm(EMPTY_FORM);
      setNotice("Your support request was sent. ARK will use the email you provided to follow up.");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 text-white">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-slate-300">ARK Websites</p><h1 className="mt-2 text-3xl font-black sm:text-5xl">ARK Client Center Support</h1></div>
          <div className="flex gap-2"><Link href="/about" className="rounded-xl border border-white/30 px-4 py-2 text-sm font-black">About the App</Link><Link href="/login" className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">Sign In</Link></div>
        </header>

        <div className="mt-8 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <h2 className="text-2xl font-black">Get help</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">Existing customers can sign in and use Requests for account-specific changes or urgent receptionist problems. This public form is available for login trouble, App Store questions, privacy questions, and general support.</p>
            <div className="mt-5 space-y-3 text-sm">
              <Link href="/login" className="block rounded-xl bg-slate-950 px-4 py-3 text-center font-black text-white">Sign In to Your Account</Link>
              <Link href="/docs" className="block rounded-xl border border-slate-300 px-4 py-3 text-center font-black">Read the App Docs</Link>
              <div className="grid grid-cols-2 gap-2"><Link href="/privacy" className="rounded-xl border border-slate-300 px-3 py-2.5 text-center text-xs font-black">Privacy Policy</Link><Link href="/terms" className="rounded-xl border border-slate-300 px-3 py-2.5 text-center text-xs font-black">Terms of Use</Link></div>
            </div>
          </section>

          <form onSubmit={submit} className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <h2 className="text-2xl font-black">Contact ARK</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Tell us what you need and include an email where ARK can reach you.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label><span className="text-xs font-black uppercase tracking-wide text-slate-500">Your name</span><input required value={form.name} onChange={(event) => update("name", event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-950" /></label>
              <label><span className="text-xs font-black uppercase tracking-wide text-slate-500">Business name</span><input required value={form.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="Your business name" className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-950" /></label>
              <label className="sm:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Email</span><input required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-950" /></label>
              <label className="sm:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Subject</span><input value={form.subject} onChange={(event) => update("subject", event.target.value)} placeholder="What do you need help with?" className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-slate-950" /></label>
              <label className="hidden" aria-hidden="true"><span>Company website</span><input tabIndex={-1} autoComplete="off" value={form.companyWebsite} onChange={(event) => update("companyWebsite", event.target.value)} /></label>
              <label className="sm:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Message</span><textarea required minLength={10} rows={6} value={form.message} onChange={(event) => update("message", event.target.value)} placeholder="Explain what is happening and how ARK can help." className="mt-1.5 w-full rounded-xl border border-slate-300 p-3 outline-none focus:border-slate-950" /></label>
            </div>
            {notice && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</p>}
            {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
            <button disabled={sending} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{sending ? "Sending…" : "Send Support Request"}</button>
          </form>
        </div>
      </div>
    </main>
  );
}
