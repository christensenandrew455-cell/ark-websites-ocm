"use client";

import { signInWithCustomToken } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readApiJson } from "../../lib/apiResponse";
import { auth } from "../../lib/firebase";
import { formatNotificationPhone, NOTIFICATION_SMS_FROM_DISPLAY } from "../../lib/notificationPreferences";
import { publicFormError } from "../../lib/userFacingError";
import { useAuth } from "../../components/AuthProvider";
import InfoTip from "../../components/InfoTip";

function ChannelChoice({ checked, onChange, title, destination, help }) {
  const id = `channel-${title.toLowerCase().replaceAll(" ", "-")}`;
  return <div className={`flex items-start gap-3 rounded-2xl border p-5 transition ${checked ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white"}`}>
    <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-indigo-700" />
    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer"><span className="block text-lg font-black text-slate-950">{title}</span><span className="mt-1 block break-words text-sm font-bold text-indigo-800">{destination}</span></label>
    {help && <InfoTip label={`About ${title.toLowerCase()}`} align="right">{help}</InfoTip>}
  </div>;
}

export default function PersonalizationSetupPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [account, setAccount] = useState({ accountEmail: "", accountPhone: "" });
  const [channels, setChannels] = useState([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/signup"); return; }
    if (profile?.status === "pending_verification") { router.replace("/signup/verify"); return; }
    if (profile?.status === "pending_business_setup") { router.replace("/setup/business"); return; }
    if (profile?.status === "active") { router.replace("/"); return; }
    let active = true;
    (async () => {
      try {
        const token = await user.getIdToken(true);
        const response = await fetch("/api/signup/draft", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await readApiJson(response, "Unable to load personalization.");
        if (!active) return;
        setAccount({ accountEmail: data.profile?.businessEmail || profile?.accountEmail || "", accountPhone: data.profile?.businessPhone || profile?.accountPhone || "" });
        setChannels(Array.isArray(data.personalization?.notificationChannels) ? data.personalization.notificationChannels : []);
      } catch (loadError) {
        if (active) setError(publicFormError(loadError, "Unable to load personalization."));
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, [loading, profile?.accountEmail, profile?.accountPhone, profile?.status, router, user]);

  function updateChannel(channel, selected) {
    setError("");
    setChannels((current) => selected
      ? [...new Set([...current, channel])]
      : current.filter((item) => item !== channel));
  }

  async function continueSignup(event) {
    event.preventDefault();
    if (!channels.length) return setError("Choose email, text message, or both.");
    setSaving(true);
    setError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/signup/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notificationChannels: channels }),
      });
      const data = await readApiJson(response, "Unable to save notification preferences.");
      if (data.nextPath !== "/signup/payment" || !data.continuationToken) throw new Error("Unable to open plan and payment.");
      try {
        await signInWithCustomToken(auth, data.continuationToken);
      } catch {
        await user.getIdToken(true);
      }
      window.location.replace(data.nextPath);
    } catch (saveError) {
      setError(publicFormError(saveError, "Unable to save notification preferences."));
      setSaving(false);
    }
  }

  if (loading || !ready) return <main className="ark-auth-page grid min-h-screen place-items-center text-sm font-semibold text-white">Opening personalization…</main>;

  return <main className="ark-auth-page min-h-screen px-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] pt-10">
    <section className="ark-auth-card mx-auto w-full max-w-3xl rounded-3xl p-6 shadow-2xl sm:p-9">
      <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">ARK Client Center</p>
      <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Step 4 of 5 · Personalization</p>
      <div className="mt-3 flex items-center gap-2"><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Where should alerts go?</h1><InfoTip label="About alerts">Choose email, text, or both for new leads and important account updates. You can change this later.</InfoTip></div>

      <form onSubmit={continueSignup} className="mt-7 space-y-4">
        <ChannelChoice
          checked={channels.includes("email")}
          onChange={(selected) => updateChannel("email", selected)}
          title="Email notifications"
          destination={account.accountEmail}
        />
        <ChannelChoice
          checked={channels.includes("sms")}
          onChange={(selected) => updateChannel("sms", selected)}
          title="Text message notifications"
          destination={formatNotificationPhone(account.accountPhone)}
          help={`Alerts come from ${NOTIFICATION_SMS_FROM_DISPLAY}, the ARK number used during signup.`}
        />
        {channels.includes("sms") && <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold leading-5 text-slate-600">By choosing text notifications, you consent to receive automated transactional texts from ARK at your verified account phone number. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.</p>}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
        <div className="grid gap-3 pt-3 sm:grid-cols-2">
          <Link href="/setup/business" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-black text-slate-700">Back</Link>
          <button type="submit" disabled={saving || !channels.length} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Saving…" : "Next: plan & payment"}</button>
        </div>
      </form>
    </section>
  </main>;
}
