import Link from "next/link";

const features = [
  ["Lead review", "Review people who contacted the business, see saved details, and accept qualified leads into the client list."],
  ["Client management", "Keep current client details together and use supported contact or calendar workflows when scheduling work."],
  ["Business support", "Submit normal change requests or priority help from the signed-in account and track their status."],
  ["Account controls", "Manage business details, payment methods, policies, documentation, and downloadable client data."],
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="bg-slate-950 px-4 py-12 text-white sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-300">ARK Websites</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">ARK Client Center</h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-slate-300 sm:text-xl sm:leading-8">A private business app for reviewing receptionist leads, organizing clients, managing account information, and contacting ARK support.</p>
          <div className="mt-7 flex flex-wrap gap-3"><Link href="/login" className="rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950">Sign In</Link><Link href="/support" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-black">Contact Support</Link><Link href="/docs" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-black">Read the Docs</Link></div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="grid gap-4 sm:grid-cols-2">
          {features.map(([title, description]) => <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>)}
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Pricing and minutes</p>
          <h2 className="mt-2 text-2xl font-black">How the service price is structured</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-100 p-4"><h3 className="font-black">Base subscription</h3><p className="mt-1 text-sm leading-6 text-slate-600">The recurring service price shown during account setup or in the written plan.</p></div>
            <div className="rounded-2xl bg-slate-100 p-4"><h3 className="font-black">Included minutes</h3><p className="mt-1 text-sm leading-6 text-slate-600">The standard service is designed around up to 1,500 receptionist minutes per billing cycle.</p></div>
            <div className="rounded-2xl bg-slate-100 p-4"><h3 className="font-black">Overage</h3><p className="mt-1 text-sm leading-6 text-slate-600">An additional charge applies only after included minutes are exceeded and only when the rate has been disclosed for the account.</p></div>
          </div>
          <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">Exact subscription pricing, included usage, and any overage rate are controlled by the customer’s plan, order, invoice, or written agreement. This page does not replace those account-specific terms.</p>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-black">Privacy and support</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">ARK administrators can access the business, lead, client, request, connection, billing-status, and technical information needed to operate and support the service. ARK does not receive or store full payment-card numbers. The Privacy Policy explains access, providers, retention, exports, and deletion in detail.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3"><Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Privacy Policy</Link><Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-black">Terms of Use</Link><Link href="/support" className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">Support</Link></div>
        </section>
      </div>
    </main>
  );
}
