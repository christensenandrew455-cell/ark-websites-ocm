import SignupAboutContinue from "../components/SignupAboutContinue";
import { EMPLOYEES_AVAILABLE, MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL, UPCOMING_FEATURE_MESSAGE } from "../lib/launchFeatures";

const features = [
  ["AI receptionist leads", "Review calls and leads delivered by the receptionist, see saved details, and accept qualified leads into the client list."],
  [MESSAGES_AVAILABLE ? "Optional lead conversations" : `Messages · ${UPCOMING_FEATURE_LABEL}`, MESSAGES_AVAILABLE ? "Turn on Messages when the business needs texting. Usage is measured in SMS parts, including longer messages that require multiple parts." : "Customer texting is planned for next month and is not included in the current launch version."],
  [EMPLOYEES_AVAILABLE ? "Optional employee routing" : `Employees · ${UPCOMING_FEATURE_LABEL}`, EMPLOYEES_AVAILABLE ? "Turn on Employees to approve employee accounts, control visible lead fields, and assign leads or clients to one employee." : "Employee accounts and work assignment are planned for next month and are not included in the current launch version."],
  ["One owner account", "Manage receptionist details, feature controls, payment methods, policies, downloads, and account deletion in one place."],
];

export default async function AboutPage({ searchParams }) {
  const params = await searchParams;
  const setup = params?.setup === "1";
  return <main className="min-h-screen bg-transparent text-slate-950">
    <section className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-12 text-white sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">ARK Client Center</p>
        {setup && <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-slate-300">Step 3 of 4 · About</p>}
        <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">About your Client Center</h1>
        <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-slate-300 sm:text-xl sm:leading-8">{MESSAGES_AVAILABLE && EMPLOYEES_AVAILABLE ? "A private business app for AI receptionist leads, optional customer messaging, optional employee routing, and simple usage-based billing." : `A private business app for AI receptionist leads and simple usage-based billing. ${UPCOMING_FEATURE_MESSAGE}`}</p>
      </div>
    </section>
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="grid gap-4 sm:grid-cols-2">{features.map(([title, description]) => <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>)}</section>
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">One account</p>
        <h2 className="mt-2 text-2xl font-black">$50 per month, then pay for usage</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-950 p-5 text-white"><h3 className="text-xl font-black">New leads · $2 each</h3><p className="mt-2 text-sm leading-6 text-slate-300">A lead is counted when it arrives. Keeping or deleting it later never counts it again or removes that event.</p></div>
          {MESSAGES_AVAILABLE ? <div className="rounded-2xl bg-indigo-950 p-5 text-white"><h3 className="text-xl font-black">Chats · $1 each, then $1 per 50 parts</h3><p className="mt-2 text-sm leading-6 text-indigo-100">A chat is charged only when it is created. Inbound and outbound parts share a rolling counter, and unfinished progress carries into the next period.</p></div> : <div className="rounded-2xl bg-slate-100 p-5"><h3 className="text-xl font-black">Messages · {UPCOMING_FEATURE_LABEL}</h3><p className="mt-2 text-sm leading-6 text-slate-600">Messaging usage charges do not apply while this feature is unavailable.</p></div>}
          {EMPLOYEES_AVAILABLE ? <div className="rounded-2xl bg-amber-50 p-5"><h3 className="text-xl font-black">Employees · $5 each</h3><p className="mt-2 text-sm leading-6 text-slate-600">Each approved active employee used during the billing period.</p></div> : <div className="rounded-2xl bg-slate-100 p-5"><h3 className="text-xl font-black">Employees · {UPCOMING_FEATURE_LABEL}</h3><p className="mt-2 text-sm leading-6 text-slate-600">Employee usage charges do not apply while this feature is unavailable.</p></div>}
        </div>
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.</p>
      </section>
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-2xl font-black">Privacy and account access</h2><p className="mt-3 text-sm leading-6 text-slate-600">ARK administrators can access business, owner, employee, lead, client, assignment, supported conversation, billing-status, and technical information needed to operate and support the Service. Approved employees receive only assigned records and owner-enabled fields through filtered APIs. ARK does not receive or store full payment-card numbers.</p></section>
      {setup && <SignupAboutContinue />}
    </div>
  </main>;
}
