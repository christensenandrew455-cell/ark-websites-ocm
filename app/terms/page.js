import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "../lib/legal";

const sections = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    body: (
      <>
        <p>These Terms of Use govern access to ARK Client Center and the related AI receptionist, lead-management, employee, messaging, storage, support, website, billing, and account services provided by ARK Websites (collectively, the “Service”). By creating an account, joining a business as an employee, selecting a plan, checking the agreement box, adding a payment method, or continuing to use the Service, you agree to these Terms and the Privacy Policy.</p>
        <p>Business owners represent that they have authority to accept these Terms for the business. Employees represent that the information used to join a business is accurate and that they are authorized to work under that business account.</p>
      </>
    ),
  },
  {
    id: "paid-service",
    title: "2. Plans, included usage, and overages",
    body: (
      <>
        <p>The Service is provided on an ongoing paid basis and continues until canceled or terminated under these Terms. The account owner authorizes Stripe to charge the payment method associated with the account for the selected plan, usage overages, employee-seat overages, taxes where applicable, and other charges separately agreed in writing.</p>
        <p><strong>Solo:</strong> $100 USD per monthly billing period. Solo includes the first 50 unique AI receptionist leads delivered into Contacted Me during that billing period. Each additional lead is $5 USD.</p>
        <p><strong>Solo Pro:</strong> $200 USD per monthly billing period. Solo Pro includes the first 50 unique AI receptionist leads delivered into Contacted Me and the first 50 new lead conversations started during that billing period. Each additional lead is $5 USD, and each additional new lead conversation is $5 USD.</p>
        <p><strong>Business:</strong> $300 USD per monthly billing period. Business includes the first 75 unique AI receptionist leads, the first 75 new lead conversations, and up to three active employee accounts during that billing period. Each additional lead is $5 USD, each additional new lead conversation is $5 USD, and each additional active employee account is $25 USD per billing period.</p>
        <p><strong>What counts as a lead:</strong> A lead is counted when the AI receptionist delivers a new, unique lead record into Contacted Me. The lead remains counted if it is later accepted, contacted, assigned, moved, edited, or deleted. Duplicate records caused solely by a verified system error may be corrected by ARK.</p>
        <p><strong>What counts as a conversation:</strong> On Solo Pro and Business, one conversation is counted when an owner or authorized employee first starts a distinct conversation thread with a lead. Additional messages sent or received inside that same conversation do not create additional conversation charges. A separate thread with another lead counts separately.</p>
        <p><strong>What counts as an active employee:</strong> On Business, an employee account counts toward the active employee total when the business owner approves or reactivates it. Pending and disabled employee accounts are not intended to count as active seats. Seat usage may be measured during the billing period and may not be reduced retroactively merely because an employee is disabled later.</p>
        <p><strong>Included usage resets:</strong> Included leads, conversations, and employee seats reset or are measured at the start of each monthly billing period and do not roll over. Overage charges have no monthly maximum unless ARK agrees to one in writing.</p>
        <p><strong>Dashboard estimate:</strong> The dashboard may show the current plan fee, included usage remaining, overage counts, overage cost, and estimated total for the current billing period. Usage can take time to process. Stripe’s finalized invoice, credits, taxes, corrections, disputes, and payment records control the final amount charged.</p>
        <p>Plan changes, custom work, provider pass-through charges, taxes, or other fees apply only when separately disclosed or agreed. An account-specific written agreement controls if it expressly differs from these general pricing terms.</p>
      </>
    ),
  },
  {
    id: "employees",
    title: "3. Business owners, employees, assignments, and access",
    body: (
      <>
        <p>Business owners control employee approval, activation, disabling, assignments, and the categories of lead information employees may view. An employee cannot access assigned business data until the owner approves the employee account.</p>
        <p>Employees are intended to see only leads, clients, and conversations assigned to them, and only the fields enabled by the business owner. Owner settings can include access to names, phone numbers, email addresses, addresses, requested work, requested dates or times, and notes. Some information may remain hidden even when another field is visible.</p>
        <p>The business owner is responsible for deciding which employees should have access, promptly disabling access when it is no longer appropriate, confirming assignments, and ensuring employee use complies with law and the business’s own policies. ARK may restrict an employee account if the owner disables it, the Business plan ends, payment is restricted, or security or legal concerns arise.</p>
        <p>Employee accounts do not create separate payment obligations to ARK. Charges for employee seats and employee-started lead conversations are charged to the Business owner account.</p>
      </>
    ),
  },
  {
    id: "payment-enforcement",
    title: "4. Payment failures and account enforcement",
    body: (
      <>
        <p><strong>Initial 24-hour period:</strong> When Stripe reports that a scheduled payment was not completed, ARK normally allows a 24-hour period for the payment to clear or the payment method to be corrected before showing the incident in the account or beginning the enforcement period.</p>
        <p><strong>Rolling six-month incident record:</strong> Late-payment incidents are counted within a rolling six-month period. A successfully completed payment resolves the current incident and restores available access, but the incident may remain in the rolling count for six months.</p>
        <p><strong>First incident within six months:</strong> After the initial 24-hour period, ARK normally provides seven days to complete payment before placing the account in payment-restricted mode. If payment remains unpaid for seven additional days while restricted, the account may be placed into manual deletion review.</p>
        <p><strong>Second incident within six months:</strong> After the initial 24-hour period, ARK may place the account directly into payment-restricted mode without another seven-day full-access grace period. If payment remains unpaid for seven days while restricted, the account may be placed into manual deletion review.</p>
        <p><strong>Third or later incident within six months:</strong> After the initial 24-hour period, ARK may place the account into payment-restricted mode and manual deletion review without another grace period.</p>
        <p><strong>Payment-restricted mode:</strong> The business may continue receiving new leads and may review and accept those leads into Clients. Other features may be unavailable, including settings changes, employee management, employee access, Help messages, messaging, and client-data downloads.</p>
        <p><strong>Deletion is a manual decision:</strong> The Service does not automatically permanently delete an account solely because a payment deadline passes. An authorized ARK administrator reviews the account and must separately confirm permanent deletion.</p>
        <p><strong>Payment restoration:</strong> When Stripe confirms that the required payment has been completed, the payment warning and payment restriction are designed to clear automatically. Processing delays, disputes, reversals, or provider outages may delay restoration.</p>
        <p>Applicable law and any separate written agreement control if they require a different process.</p>
      </>
    ),
  },
  {
    id: "cancellation",
    title: "5. Cancellation and deletion requests",
    body: (
      <>
        <p>Account owners may request cancellation through Settings, Help, and Send a Message while the account has full access. Unless immediate deletion is requested or ARK agrees otherwise, service normally remains available through the end of the current paid billing period and then stops before the next renewal.</p>
        <p>Charges already incurred during the current billing period, including valid usage and employee-seat overages, remain due unless ARK issues a credit or applicable law requires otherwise.</p>
        <p>Permanent deletion requires administrator review and confirmation. When permanent deletion is completed, the active business account and its active Contacted Me, Clients, employee-membership, assignment, and conversation records are deleted together. Deleted active data may not be recoverable.</p>
      </>
    ),
  },
  {
    id: "data-export",
    title: "6. Client-data download and retention",
    body: (
      <>
        <p>While an owner account is in good standing, Settings includes a Download Client Data control that provides a JSON copy of current Contacted Me records, accepted Clients, account details, and Help-message history. Employee accounts do not receive the owner’s full account export through the employee workspace.</p>
        <p>ARK may disable downloads while required service charges remain unpaid or the account is in payment-restricted mode. A separate custom export may require additional preparation time or an agreed service charge.</p>
        <p>Download needed information before permanent deletion. After deletion, active account, employee, lead, client, assignment, and conversation records may no longer exist and may not be recoverable or available for export.</p>
        <p>ARK may retain limited backup, billing, transaction, usage, security, fraud-prevention, agreement, audit, or legal records for a reasonable period where required or permitted by law. Backup copies may remain until normal backup rotation completes.</p>
      </>
    ),
  },
  {
    id: "support",
    title: "7. Help and account communication",
    body: (
      <>
        <p>Signed-in owners can open Settings and select Help. Help provides Docs, an in-app AI guide, and a Send a Message option for technical issues, billing questions, service problems, cancellation, deletion, or other owner account requests.</p>
        <p>The AI guide can explain how to use the app and provide page links, but it cannot change account data, billing, employees, assignments, leads, conversations, or settings. Employee accounts should contact their business owner about access and assignments.</p>
        <p>Signed-in Help messages may be unavailable while the account is payment-restricted. The public Support page remains available when the signed-in app cannot be accessed.</p>
      </>
    ),
  },
  {
    id: "responsibilities",
    title: "8. Customer and employee responsibilities",
    body: (
      <>
        <p>Users are responsible for the accuracy and legality of information they provide, their instructions to the Service, the security of login credentials and downloaded files, and their use of customer or lead information. The business must have any notices, permissions, and consents required to collect, record, contact, message, assign, store, export, or process information through the Service.</p>
        <p>Users may not share credentials improperly, attempt to access unassigned or hidden information, use another person’s employee account, or use the Service for unlawful, fraudulent, abusive, harassing, deceptive, privacy-invasive, or security-invasive activity.</p>
      </>
    ),
  },
  {
    id: "ai-output",
    title: "9. Use of information and AI output",
    body: (
      <>
        <p>The Service may organize, summarize, assign, route, or generate information using automated systems. Users remain responsible for reviewing information and deciding how to use it.</p>
        <p>To the maximum extent permitted by law, ARK is not responsible for business decisions, communications, promises, estimates, assignments, actions, or other results based on information, leads, summaries, recordings, AI output, messages, or customer data made available through the Service. The Service is not a substitute for professional advice.</p>
      </>
    ),
  },
  {
    id: "availability",
    title: "10. Availability and changes to the Service",
    body: (
      <>
        <p>ARK works to maintain and test the Service but does not promise uninterrupted or error-free operation. Maintenance, updates, third-party outages, internet, phone, messaging-provider, security, or other circumstances outside ARK’s control may affect availability or message delivery.</p>
        <p>ARK may modify features, providers, workflows, plan requirements, or technical requirements when reasonably necessary to maintain, secure, improve, or operate the Service.</p>
      </>
    ),
  },
  {
    id: "suspension",
    title: "11. Suspension and termination",
    body: <p>ARK may suspend, restrict, or terminate owner or employee access for nonpayment, misuse, security risk, legal requirements, material breach of these Terms, owner instruction, or conduct that could harm ARK, its providers, customers, or other people. Where reasonable, ARK will provide notice and an opportunity to correct the issue.</p>,
  },
  {
    id: "liability",
    title: "12. Disclaimer and limitation of liability",
    body: (
      <>
        <p>The Service is provided “as is” and “as available” to the extent permitted by law. ARK disclaims implied warranties that may legally be disclaimed, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
        <p>To the maximum extent permitted by law, ARK will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, business, goodwill, revenue, or opportunities arising from the Service. ARK’s total liability for a claim will not exceed the amount paid to ARK for the Service during the three months before the event giving rise to the claim. These limits do not apply where applicable law does not allow them.</p>
      </>
    ),
  },
  {
    id: "updates",
    title: "13. Updates to these Terms",
    body: <p>ARK may update these Terms as the Service, pricing, employee features, providers, or legal requirements change. The version and effective date appear at the top of this page. If a material update requires new consent, ARK may ask users to accept the revised Terms before continuing to use the Service.</p>,
  },
  {
    id: "contact",
    title: "14. Contact and account requests",
    body: <p>Owners can use <strong>Settings → Help → Send a Message</strong> for account-specific questions, cancellation, deletion, billing, technical issues, or other requests. Employees should first contact the business owner for employee approval, assignments, or visibility questions. Use the public <Link href="/support" className="font-black underline">Support page</Link> when the signed-in app cannot be accessed.</p>,
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">ARK Client Center</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Terms of Use</h1><p className="mt-3 text-sm font-semibold text-slate-500">Effective {LEGAL_EFFECTIVE_DATE} · Version {TERMS_VERSION}</p></div>
          <div className="flex flex-wrap gap-2"><Link href="/about" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">About</Link><Link href="/support" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Support</Link><Link href="/privacy" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Privacy</Link></div>
        </div>
        <div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-28"><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div>
      </article>
    </main>
  );
}
