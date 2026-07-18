import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "../lib/legal";

const sections = [
  {
    title: "1. Agreement to these Terms",
    body: (
      <>
        <p>These Terms of Use govern access to ARK Client Center and the related receptionist, lead-management, storage, support, billing, and account services provided by ARK Websites (collectively, the “Service”). By creating an account, checking the agreement box, adding a payment method, or continuing to use the Service, you agree to these Terms and the Privacy Policy.</p>
        <p>You represent that you have authority to accept these Terms for the business named on the account.</p>
      </>
    ),
  },
  {
    title: "2. Ongoing paid service",
    body: (
      <>
        <p>The Service is provided on an ongoing paid basis and continues until canceled or terminated under these Terms. You authorize recurring charges according to the price, billing schedule, and plan terms presented to you or otherwise agreed in writing.</p>
        <p>Your service fee may cover account and customer-data storage, software maintenance, updates, AI usage, business-number or telephony usage, monthly testing, account support, and the ability to submit change requests.</p>
        <p>Plans may include usage limits. Additional usage charges may apply when those limits are exceeded, but any applicable limits and overage rates will be disclosed in your order, invoice, plan details, or another written agreement before those charges are assessed.</p>
      </>
    ),
  },
  {
    title: "3. Payment failures and account enforcement",
    body: (
      <>
        <p><strong>First late-payment incident:</strong> ARK may allow seven days to cure the missed payment before disabling the account. If the balance remains unpaid for seven additional days after disablement, ARK may permanently delete the account and its data.</p>
        <p><strong>Second late-payment incident:</strong> ARK may disable the account immediately after a missed payment. If the balance is not paid within seven days, ARK may permanently delete the account and its data.</p>
        <p><strong>Third late-payment incident:</strong> ARK may permanently delete the account after the missed payment without another grace period.</p>
        <p>ARK may choose to provide additional time or restore an account, but doing so once does not require ARK to do so again. Applicable law and any separate written agreement control if they require a different process.</p>
      </>
    ),
  },
  {
    title: "4. Cancellation and deletion requests",
    body: (
      <>
        <p>You may request cancellation at any time through the Request a Change or support feature. Unless you request immediate deletion or ARK agrees otherwise, service normally remains available through the end of the current paid billing period and then stops before the next renewal.</p>
        <p>You may also request immediate account deletion. Once deletion is completed, account access and active customer data may not be recoverable.</p>
      </>
    ),
  },
  {
    title: "5. Data export and retention",
    body: (
      <>
        <p>You may request a copy or export of the account data ARK maintains for your business. Submit the request before account deletion and allow reasonable time for preparation and delivery.</p>
        <p>After deletion, ARK may retain limited backup, billing, security, fraud-prevention, or legal records for a reasonable period where required or permitted by law. The Privacy Policy explains data handling in more detail.</p>
      </>
    ),
  },
  {
    title: "6. Change requests and support",
    body: (
      <>
        <p>You may submit change requests as often as needed. Requests are reviewed for feasibility, safety, compatibility, scope, and account status. Submission does not guarantee that every request will be completed exactly as proposed or within a particular time.</p>
        <p>Priority support is intended for serious service problems. Routine updates should be submitted as normal change requests.</p>
      </>
    ),
  },
  {
    title: "7. Customer responsibilities",
    body: (
      <>
        <p>You are responsible for the accuracy and legality of information you provide, your instructions to the Service, the security of your login credentials, and your use of customer or lead information. You must have any notices, permissions, and consents required to collect, record, contact, store, or process information through the Service.</p>
        <p>You may not use the Service for unlawful, fraudulent, abusive, harassing, deceptive, or privacy-invasive activity, or to interfere with the Service or another account.</p>
      </>
    ),
  },
  {
    title: "8. Use of information and AI output",
    body: (
      <>
        <p>The Service may organize, summarize, route, or generate information using automated systems. You remain responsible for reviewing information and deciding how to use it.</p>
        <p>To the maximum extent permitted by law, ARK is not responsible for business decisions, communications, promises, estimates, actions, or other results based on information, leads, summaries, recordings, AI output, or customer data made available through the Service. The Service is not a substitute for professional, legal, financial, medical, or other specialized advice.</p>
      </>
    ),
  },
  {
    title: "9. Availability and changes to the Service",
    body: (
      <>
        <p>ARK works to maintain and test the Service but does not promise uninterrupted or error-free operation. Maintenance, updates, third-party outages, internet or phone-provider failures, security events, or circumstances outside ARK’s control may affect availability.</p>
        <p>ARK may modify features, providers, workflows, or technical requirements when reasonably necessary to maintain, secure, improve, or operate the Service.</p>
      </>
    ),
  },
  {
    title: "10. Suspension and termination",
    body: (
      <p>ARK may suspend, restrict, or terminate access for nonpayment, misuse, security risk, legal requirements, material breach of these Terms, or conduct that could harm ARK, its providers, customers, or other people. Where reasonable, ARK will provide notice and an opportunity to correct the issue.</p>
    ),
  },
  {
    title: "11. Disclaimer and limitation of liability",
    body: (
      <>
        <p>The Service is provided “as is” and “as available” to the extent permitted by law. ARK disclaims implied warranties that may legally be disclaimed, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
        <p>To the maximum extent permitted by law, ARK will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, business, goodwill, revenue, or opportunities arising from the Service. ARK’s total liability for a claim will not exceed the amount you paid ARK for the Service during the three months before the event giving rise to the claim. These limits do not apply where applicable law does not allow them.</p>
      </>
    ),
  },
  {
    title: "12. Updates to these Terms",
    body: (
      <p>ARK may update these Terms as the Service or legal requirements change. The version and effective date appear at the top of this page. If a material update requires new consent, ARK may ask you to accept the revised Terms before continuing to use the Service.</p>
    ),
  },
  {
    title: "13. Contact and account requests",
    body: (
      <p>Use the Request a Change or Priority Support options in Settings for questions, cancellation, deletion, data-export, billing, or account requests.</p>
    ),
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">ARK Client Center</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Terms of Use</h1>
            <p className="mt-3 text-sm font-semibold text-slate-500">Effective {LEGAL_EFFECTIVE_DATE} · Version {TERMS_VERSION}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/privacy" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Privacy Policy</Link>
            <Link href="/signup" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Back</Link>
          </div>
        </div>

        <div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2>
              <div className="mt-2 space-y-3">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
