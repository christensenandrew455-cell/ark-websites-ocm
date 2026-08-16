import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL, UPCOMING_FEATURE_MESSAGE } from "../lib/launchFeatures";

const features = [
  ["AI receptionist leads", "Review calls and leads delivered by the receptionist, see saved details, and accept qualified leads into the client list."],
  [MESSAGES_AVAILABLE ? "Optional lead conversations" : `Messages · ${UPCOMING_FEATURE_LABEL}`, MESSAGES_AVAILABLE ? "Turn on Messages when the business needs texting. Usage is measured in SMS parts, including longer messages that require multiple parts." : "Customer texting is planned for next month and is not included in the current launch version."],
  ["One owner account", "Manage receptionist details, feature controls, payment methods, policies, downloads, and account deletion in one place."],
];

export default function AboutPage() {
  return <main className="min-h-screen bg-transparent text-slate-950">
    <section className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-12 text-white sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">ARK Client Center</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">About your Client Center</h1>
        <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-slate-300 sm:text-xl sm:leading-8">A private business app for AI receptionist leads and simple usage-based billing. {!MESSAGES_AVAILABLE && UPCOMING_FEATURE_MESSAGE}</p>
      </div>
    </section>
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="grid gap-4 sm:grid-cols-2">{features.map(([title, description]) => <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>)}</section>
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">One account</p>
        <h2 className="mt-2 text-2xl font-black">$50 per month, then pay for usage</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-950 p-5 text-white"><h3 className="text-xl font-black">Calls or new leads · $2 each</h3><p className="mt-2 text-sm leading-6 text-slate-300">A lead saved from the same receptionist call counts once. Keeping or deleting it later never counts it again or removes that event.</p></div>
          {MESSAGES_AVAILABLE ? <div className="rounded-2xl bg-indigo-950 p-5 text-white"><h3 className="text-xl font-black">Chats · $1 each, then $1 per 50 parts</h3><p className="mt-2 text-sm leading-6 text-indigo-100">A chat is charged only when it is created. Inbound and outbound parts share a rolling counter.</p></div> : <div className="rounded-2xl bg-slate-100 p-5"><h3 className="text-xl font-black">Messages · {UPCOMING_FEATURE_LABEL}</h3><p className="mt-2 text-sm leading-6 text-slate-600">Messaging usage charges do not apply while this feature is unavailable.</p></div>}
        </div>
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.</p>
      </section>
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-2xl font-black">Payment and privacy</h2><p className="mt-3 text-sm leading-6 text-slate-600">Stripe securely collects the payment method, starts the $50 monthly subscription, and processes an exact $20 whenever the rolling usage balance reaches the threshold. ARK does not receive or store full card numbers.</p></section>
    </div>
  </main>;
}
