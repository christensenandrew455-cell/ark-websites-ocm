import Link from "next/link";

const features = [
  ["AI receptionist leads", "Review new leads delivered by the receptionist, see saved details, and accept qualified leads into the client list."],
  ["Lead conversations", "Start a distinct lead conversation on Solo Pro or Business without paying for every individual text inside the same thread."],
  ["Business employee routing", "Approve employee accounts, control visible lead fields, and assign leads or clients to one employee."],
  ["Account controls", "Manage business details, payment methods, policies, documentation, support, and downloadable client data."],
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="bg-slate-950 px-4 py-12 text-white sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-300">ARK Websites</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">ARK Client Center</h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-slate-300 sm:text-xl sm:leading-8">A private business app for AI receptionist leads, client organization, lead conversations, employee routing, and monthly usage.</p>
          <div className="mt-7 flex flex-wrap gap-3"><Link href="/login" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950">Sign In</Link><Link href="/signup" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-black">Make an Account</Link><Link href="/docs" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-black">Read the Docs</Link></div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="grid gap-4 sm:grid-cols-2">{features.map(([title, description]) => <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>)}</section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Plans</p>
          <h2 className="mt-2 text-2xl font-black">Choose Solo or build a Business workspace</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-slate-100 p-5"><h3 className="text-xl font-black">Solo · $100/month</h3><p className="mt-2 text-sm leading-6 text-slate-600">Includes 50 AI receptionist leads each billing period. Additional leads are $5 each.</p></div>
            <div className="rounded-2xl bg-slate-800 p-5 text-white"><h3 className="text-xl font-black">Solo Pro · $200/month</h3><p className="mt-2 text-sm leading-6 text-slate-300">Includes 50 leads and 50 new lead conversations. Additional leads or conversations are $5 each. Follow-up texts inside the same thread are included.</p></div>
            <div className="rounded-2xl bg-slate-950 p-5 text-white"><h3 className="text-xl font-black">Business · $300/month</h3><p className="mt-2 text-sm leading-6 text-slate-300">Includes 75 leads, 75 new lead conversations, and 3 active employee accounts. Extra leads or conversations are $5 each; extra active employees are $25 each.</p></div>
          </div>
          <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">Business owners approve employee access, choose visible lead fields, and assign work. Included usage resets or is measured each billing period. The Terms explain exact billing rules.</p>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-black">Privacy and support</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">ARK administrators can access business, owner, employee, lead, client, assignment, supported conversation, billing-status, and technical information needed to operate and support the Service. Approved employees receive only assigned records and owner-enabled fields through filtered APIs. ARK does not receive or store full payment-card numbers.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3"><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/support" className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Support</Link></div>
        </section>
      </div>
    </main>
  );
}
