"use client";

import { useState } from "react";
import AppSelect from "../components/AppSelect";
import BackButton from "../components/BackButton";
import InfoTip from "../components/InfoTip";
import { useAuth } from "../components/AuthProvider";
import { FEEDBACK_SENTIMENTS, FEEDBACK_TOPICS } from "../lib/feedbackOptions";
import { TEMPORARY_FEATURES } from "../lib/temporaryFeatures";
import { ownerFacingError } from "../lib/userFacingError";

export default function FeedbackPage() {
  const { user, loading } = useAuth();
  const [sentiment, setSentiment] = useState("neutral");
  const [topic, setTopic] = useState("overall");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!user || sending) return;
    setSending(true);
    setNotice("");
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sentiment, topic, message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Feedback could not be sent.");
      setMessage("");
      setSentiment("neutral");
      setTopic("overall");
      setNotice(data.rewardGranted
        ? `Thanks. ${data.rewardLeadCredits} free leads were added to Rewards.`
        : "Feedback sent.");
    } catch (submitError) {
      setError(ownerFacingError(submitError));
    } finally {
      setSending(false);
    }
  }

  if (!TEMPORARY_FEATURES.feedback.enabled) {
    return <main className="min-h-screen px-4 py-6 sm:p-8"><div className="mx-auto max-w-2xl"><BackButton href="/settings?section=account" /><p className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-700">Feedback is not available right now.</p></div></main>;
  }
  if (loading) return <main className="grid min-h-[70vh] place-items-center text-sm font-semibold text-slate-500">Loading feedback…</main>;

  return <main className="min-h-screen bg-transparent px-3 py-4 text-slate-950 sm:p-6 md:p-8">
    <div className="mx-auto max-w-2xl">
      <BackButton href="/rewards" label="Back to Free Leads" />
      <header className="mt-5">
        <div className="flex items-center gap-2"><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Feedback</h1><InfoTip label="Feedback thank-you">Your first useful feedback may earn free leads. Positive or negative both count.</InfoTip></div>
      </header>

      {notice && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800" role="status">{notice}</p>}
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{error}</p>}

      <form onSubmit={submit} className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">
        <fieldset>
          <legend className="text-sm font-black text-slate-950">Rating</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {FEEDBACK_SENTIMENTS.map((option) => <button key={option.key} type="button" onClick={() => setSentiment(option.key)} aria-pressed={sentiment === option.key} className={`rounded-xl border px-3 py-3 text-sm font-black transition ${sentiment === option.key ? "border-blue-700 bg-blue-50 text-blue-950 ring-2 ring-blue-100" : "border-slate-200 bg-white text-slate-700"}`}>{option.shortLabel}</button>)}
          </div>
        </fieldset>

        <div className="mt-5">
          <span className="text-sm font-black text-slate-950">About</span>
          <AppSelect className="mt-2" label="Feedback topic" value={topic} onChange={setTopic} options={FEEDBACK_TOPICS.map((option) => ({ value: option.key, label: option.label }))} />
        </div>

        <label className="mt-5 block">
          <span className="text-sm font-black text-slate-950">What happened?</span>
          <textarea required minLength={10} maxLength={2000} rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us what happened or what should change." className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-blue-700" />
          <span className="mt-1 block text-right text-[10px] font-bold text-slate-400">{message.length}/2,000</span>
        </label>

        <button type="submit" disabled={sending || message.trim().length < 10} className="mt-5 w-full rounded-xl bg-blue-800 px-5 py-3.5 text-sm font-black text-white disabled:opacity-40">{sending ? "Sending…" : "Send"}</button>
      </form>
    </div>
  </main>;
}
