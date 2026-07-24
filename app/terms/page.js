import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "../lib/legal";

const sections = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    body: (
      <>
        <p>These Terms of Use govern access to ARK Client Center and the related receptionist, lead-management, storage, support, website, billing, and account services provided by ARK Websites (collectively, the “Service”). By creating an account, checking the agreement box, adding a payment method, or continuing to use the Service, you agree to these Terms and the Privacy Policy.</p>
        <p>You represent that you have authority to accept these Terms for the business named on the account.</p>
      </>
    ),
  },
  {
    id: "paid-service",
    title: "2. Ongoing paid service and receptionist pricing",
    body: (
      <>
        <p>The Service is provided on an ongoing paid basis and continues until canceled or terminated under these Terms. You authorize Stripe to charge the payment method associated with the account for the selected monthly receptionist plan, completed-call overage, taxes where applicable, and other charges separately agreed in writing.</p>
        <p><strong>Starter month:</strong> Unless an account-specific written agreement says otherwise, a new account begins on the Starter 25 plan at $49 USD per month. Starter 25 includes 25 completed calls during the monthly billing period. Calls above the included amount are charged at $1.50 USD each.</p>
        <p><strong>Other plans:</strong> ARK offers additional plans with a higher monthly payment, a larger included-call allowance, and a lower per-call overage rate. The plan name, monthly fee, included calls, and overage rate displayed in the signed-in Dashboard for the account are the account’s current pricing terms. Custom high-volume pricing applies only when separately confirmed in writing.</p>
        <p><strong>Completed call:</strong> A completed call is generally a legitimate receptionist call lasting at least 20 seconds. Known tests, immediate hang-ups, failed or rejected calls, calls caused by a documented system error, and other calls marked non-billable by ARK do not use the included-call allowance. ARK may use reasonable anti-abuse and duplicate-detection controls when classifying calls.</p>
        <p><strong>Overage:</strong> After the included-call allowance is used, each additional completed call is charged at the overage rate assigned to the current plan. Unless an account-specific written agreement states a cap, overage charges do not have a monthly maximum.</p>
        <p><strong>Plan recommendations:</strong> After the first full month, the Dashboard may use the previous month’s completed-call total to show three plan choices: a lower-monthly option, a recommended option, and an option with more included calls or a lower overage rate. Recommendations are estimates and do not guarantee that a plan will be cheapest in a future month.</p>
        <p><strong>Plan changes:</strong> A plan selected in the Dashboard is scheduled for the next calendar billing month. The current month’s plan remains locked through that month, and changing a future plan does not erase or reduce completed calls or overage already recorded. ARK does not automatically change the plan solely because usage rises or falls unless the customer separately authorizes automatic changes.</p>
        <p><strong>Monthly amount shown in the app:</strong> The Dashboard may show calls used, calls remaining, overage calls, overage dollars, and an estimated current amount due. Recent usage can take time to reach Stripe, and Stripe’s finalized invoice, credits, taxes, adjustments, disputes, or payment-processing records control the final amount charged.</p>
        <p><strong>What service charges support:</strong> The recurring and usage charges support the Service as a whole, including storage, AI usage, maintenance, upkeep, testing, third-party subscriptions, labor, the monthly business phone-number cost, and phone usage. These descriptions explain what the customer is paying for; they do not create separate itemized rates unless a separate order, invoice, or written agreement expressly states one.</p>
        <p>Taxes, custom work, provider pass-through charges, or other fees apply only when separately disclosed or agreed. An account-specific written agreement controls if it expressly differs from these general pricing terms.</p>
      </>
    ),
  },
  {
    id: "payment-enforcement",
    title: "3. Payment failures and account enforcement",
    body: (
      <>
        <p><strong>Initial 24-hour period:</strong> When Stripe reports that a scheduled payment was not completed, ARK normally allows a 24-hour period for the payment to clear or the payment method to be corrected before showing the incident in the account or beginning the enforcement period.</p>
        <p><strong>Rolling six-month incident record:</strong> Late-payment incidents are counted within a rolling six-month period. A successfully completed payment resolves the current incident and restores available access, but the incident may remain in the rolling count for six months.</p>
        <p><strong>First incident within six months:</strong> After the initial 24-hour period, ARK normally provides seven days to complete payment before placing the account in payment-restricted mode. If payment remains unpaid for seven additional days while restricted, the account may be placed into manual deletion review.</p>
        <p><strong>Second incident within six months:</strong> After the initial 24-hour period, ARK may place the account directly into payment-restricted mode without another seven-day full-access grace period. If payment remains unpaid for seven days while restricted, the account may be placed into manual deletion review.</p>
        <p><strong>Third or later incident within six months:</strong> After the initial 24-hour period, ARK may place the account into payment-restricted mode and manual deletion review without another grace period.</p>
        <p><strong>Payment-restricted mode:</strong> The business may continue receiving new leads and may review and accept those leads into Clients. Other account features may be unavailable, including settings changes, Help messages, billing-independent account changes, and client-data downloads.</p>
        <p><strong>Deletion is a manual decision:</strong> The Service does not automatically permanently delete an account solely because a payment deadline passes. An authorized ARK administrator reviews the account and must separately confirm permanent deletion. ARK may provide additional time, restore access, or choose not to delete an account, but doing so once does not require ARK to do so again.</p>
        <p><strong>Payment restoration:</strong> When Stripe confirms that the required payment has been completed, the payment warning and payment restriction are designed to clear automatically. Processing delays, disputes, reversals, or provider outages may delay restoration.</p>
        <p>Applicable law and any separate written agreement control if they require a different process.</p>
      </>
    ),
  },
  {
    id: "cancellation",
    title: "4. Cancellation and deletion requests",
    body: (
      <>
        <p>You may request cancellation through Settings, Help, and Send a Message while the account has full access. Unless you request immediate deletion or ARK agrees otherwise, service normally remains available through the end of the current paid billing period and then stops before the next renewal. Cancellation does not reverse completed-call overage or other charges already incurred during the current period.</p>
        <p>You may also request immediate account deletion through Help. Permanent deletion requires administrator review and confirmation. <strong>When permanent deletion is completed, the active business account and its active Contacted Me and Clients records are deleted together.</strong> Deleted active account, lead, and client data may not be recoverable.</p>
      </>
    ),
  },
  {
    id: "data-export",
    title: "5. Client-data download and retention",
    body: (
      <>
        <p>While the account is in good standing, Settings includes a Download Client Data control that provides a JSON copy of current Contacted Me records, accepted Clients, account details, and Help-message history. You are responsible for securing the downloaded file and using it lawfully.</p>
        <p>ARK may disable downloads while required service charges remain unpaid or the account is in payment-restricted mode. A separate custom export may require additional preparation time or an agreed service charge.</p>
        <p>Download needed information before permanent deletion. After deletion, the active account, Contacted Me records, and Clients records may no longer exist and may not be recoverable or available for export.</p>
        <p>ARK may retain limited backup, billing, transaction, security, fraud-prevention, agreement, audit, or legal records for a reasonable period where required or permitted by law. Backup copies may remain until normal backup rotation completes. The Privacy Policy explains data handling in more detail.</p>
      </>
    ),
  },
  {
    id: "support",
    title: "6. Help and account communication",
    body: (
      <>
        <p>Signed-in customers can open Settings and select Help. Help provides links to the Docs, an in-app AI guide, and a Send a Message option for technical issues, billing questions, service problems, cancellation, deletion, or other account requests.</p>
        <p>The AI guide can explain how to use the app and provide page links, but it cannot change account data, billing, leads, or settings. Messages are reviewed for feasibility, safety, compatibility, scope, and account status. Submission does not guarantee a specific result or response time.</p>
        <p>Signed-in Help messages may be unavailable while the account is payment-restricted. The public Support page remains available for login trouble, App Store questions, privacy questions, and general support. ARK may require identity or account-authority verification before discussing account-specific information.</p>
      </>
    ),
  },
  {
    id: "responsibilities",
    title: "7. Customer responsibilities",
    body: (
      <>
        <p>You are responsible for the accuracy and legality of information you provide, your instructions to the Service, the security of your login credentials and downloaded client-data files, and your use of customer or lead information. You must have any notices, permissions, and consents required to collect, record, contact, store, export, or process information through the Service.</p>
        <p>You are responsible for reviewing your Dashboard usage, current plan, pending next-month plan, overage, and estimated amount due. Contact ARK promptly if you believe a call was incorrectly classified or a billing record is inaccurate.</p>
        <p>You may not use the Service for unlawful, fraudulent, abusive, harassing, deceptive, or privacy-invasive activity, or to interfere with the Service or another account.</p>
      </>
    ),
  },
  {
    id: "ai-output",
    title: "8. Use of information and AI output",
    body: (
      <>
        <p>The Service may organize, summarize, route, or generate information using automated systems. You remain responsible for reviewing information and deciding how to use it.</p>
        <p>To the maximum extent permitted by law, ARK is not responsible for business decisions, communications, promises, estimates, actions, or other results based on information, leads, summaries, recordings, AI output, or customer data made available through the Service. The Service is not a substitute for professional, legal, financial, medical, or other specialized advice.</p>
      </>
    ),
  },
  {
    id: "availability",
    title: "9. Availability and changes to the Service",
    body: (
      <>
        <p>ARK works to maintain and test the Service but does not promise uninterrupted or error-free operation. Maintenance, updates, third-party outages, internet or phone-provider failures, security events, or circumstances outside ARK’s control may affect availability.</p>
        <p>ARK may modify features, providers, workflows, or technical requirements when reasonably necessary to maintain, secure, improve, or operate the Service.</p>
      </>
    ),
  },
  {
    id: "suspension",
    title: "10. Suspension and termination",
    body: <p>ARK may suspend, restrict, or terminate access for nonpayment, misuse, security risk, legal requirements, material breach of these Terms, or conduct that could harm ARK, its providers, customers, or other people. Where reasonable, ARK will provide notice and an opportunity to correct the issue.</p>,
  },
  {
    id: "liability",
    title: "11. Disclaimer and limitation of liability",
    body: (
      <>
        <p>The Service is provided “as is” and “as available” to the extent permitted by law. ARK disclaims implied warranties that may legally be disclaimed, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
        <p>To the maximum extent permitted by law, ARK will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, business, goodwill, revenue, or opportunities arising from the Service. ARK’s total liability for a claim will not exceed the amount you paid ARK for the Service during the three months before the event giving rise to the claim. These limits do not apply where applicable law does not allow them.</p>
      </>
    ),
  },
  {
    id: "updates",
    title: "12. Updates to these Terms",
    body: <p>ARK may update these Terms as the Service, pricing, providers, or legal requirements change. The version and effective date appear at the top of this page. If a material update requires new consent, ARK may ask you to accept the revised Terms before continuing to use the Service.</p>,
  },
  {
    id: "contact",
    title: "13. Contact and account requests",
    body: <p>For account-specific questions, cancellation, deletion, billing, technical issues, or other requests, open <strong>Settings → Help</strong> and select Send a Message. Use the public <Link href="/support" className="font-black underline">Support page</Link> for login trouble, App Store questions, privacy questions, or general support when you cannot access the signed-in app.</p>,
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
          <div className="flex flex-wrap gap-2">
            <Link href="/about" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">About</Link>
            <Link href="/support" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Support</Link>
            <Link href="/privacy" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Privacy</Link>
          </div>
        </div>

        <div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-28">
              <h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2>
              <div className="mt-2 space-y-3">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
