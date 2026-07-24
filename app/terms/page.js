import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "../lib/legal";

const sections = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    body: <><p>These Terms of Use govern access to ARK Client Center and the related AI receptionist, lead-management, optional employee, optional messaging, storage, support, website, billing, and account services provided by ARK Websites (collectively, the “Service”). By creating an owner or employee account, checking the agreement box, adding a payment method, enabling a feature, or continuing to use the Service, you agree to these Terms and the Privacy Policy.</p><p>Owner-account users represent that they have authority to accept these Terms for the business. Employees represent that the information used to join a business is accurate and that they are authorized to work under that owner account.</p></>,
  },
  {
    id: "paid-service",
    title: "2. Monthly account and usage charges",
    body: <>
      <p>The Service is provided on an ongoing paid basis and continues until canceled or terminated under these Terms. The account owner authorizes Stripe to charge the payment method associated with the account for the monthly account fee, usage, taxes where applicable, and other charges separately agreed in writing.</p>
      <p><strong>Monthly account:</strong> $50 USD per monthly billing period for one owner account and the AI receptionist workspace.</p>
      <p><strong>Calls and leads:</strong> $2 USD for each new AI receptionist call or unique lead delivered into Contacted You during the billing period.</p>
      <p><strong>Messages:</strong> When the owner enables Messages, $1 USD is charged when an owner or authorized employee first starts a distinct message conversation with a lead. Additional outbound or inbound texts inside that same conversation do not create another conversation charge.</p>
      <p><strong>Employees:</strong> When the owner enables Employees, $5 USD is charged for each approved active employee account during the billing period. Pending and disabled employee accounts are not intended to count as active employees. Employee usage may be measured during the period and may not be reduced retroactively solely because the employee is disabled later.</p>
      <p><strong>No included allowance:</strong> The account does not include free calls, free message conversations, or free employee accounts. Usage starts with the first counted unit during each billing period.</p>
      <p><strong>What counts as a call or lead:</strong> A call or lead is counted when the AI receptionist delivers a new unique record into Contacted You. It remains counted if it is accepted, contacted, assigned, moved, edited, or deleted. Duplicate records caused solely by a verified system error may be corrected by ARK.</p>
      <p><strong>Dashboard estimate:</strong> The dashboard may show the $50 account fee, current counts, unit prices, usage charges, and estimated total. Usage can take time to process. Stripe’s finalized invoice, credits, taxes, corrections, disputes, and payment records control the final amount charged.</p>
      <p>Custom work, provider pass-through charges, taxes, or other fees apply only when separately disclosed or agreed. An account-specific written agreement controls if it expressly differs from these general pricing terms.</p>
    </>,
  },
  {
    id: "features",
    title: "3. Optional Messages and Employees features",
    body: <><p>The owner can turn Messages and Employees on or off in Settings. Turning a feature off removes its workspace access but does not reverse valid usage already incurred during the current or previous billing periods.</p><p>Messages for Employees is a separate owner control and is available only while both Messages and Employees are enabled. When enabled, approved employees may message only leads assigned to them.</p><p>ARK may temporarily prevent feature changes while an account is payment-restricted, disabled, under security review, or affected by a provider outage.</p></>,
  },
  {
    id: "employees",
    title: "4. Owners, employees, assignments, and access",
    body: <><p>Owners control whether employee accounts are available, employee approval, activation, disabling, assignments, employee messaging, and the categories of lead information employees may view. An employee cannot access assigned business data until the owner enables Employees and approves the employee account.</p><p>Employees are intended to see only leads, clients, and conversations assigned to them, and only the fields enabled by the owner. Owner settings can include access to names, phone numbers, email addresses, addresses, requested work, requested dates or times, and notes.</p><p>The owner is responsible for deciding which employees should have access, promptly disabling access when it is no longer appropriate, confirming assignments, and ensuring employee use complies with law and the business’s own policies. ARK may restrict an employee account if the owner disables it, Employees is turned off, payment is restricted, or security or legal concerns arise.</p><p>Employee accounts do not create separate payment obligations to ARK. Employee and employee-started message usage is charged to the owner account.</p></>,
  },
  {
    id: "payment-enforcement",
    title: "5. Payment failures and account enforcement",
    body: <><p><strong>Initial 24-hour period:</strong> When Stripe reports that a scheduled payment was not completed, ARK normally allows a 24-hour period for the payment to clear or the payment method to be corrected before showing the incident in the account or beginning the enforcement period.</p><p><strong>Rolling six-month incident record:</strong> Late-payment incidents are counted within a rolling six-month period. A successfully completed payment resolves the current incident and restores available access, but the incident may remain in the rolling count for six months.</p><p><strong>First incident:</strong> After the initial 24-hour period, ARK normally provides seven days to complete payment before placing the account in payment-restricted mode. If payment remains unpaid for seven additional days while restricted, the account may be placed into manual deletion review.</p><p><strong>Second incident:</strong> After the initial 24-hour period, ARK may place the account directly into payment-restricted mode. If payment remains unpaid for seven days while restricted, the account may be placed into manual deletion review.</p><p><strong>Third or later incident:</strong> ARK may place the account into payment-restricted mode and manual deletion review without another grace period.</p><p><strong>Payment-restricted mode:</strong> The business may continue receiving new leads and may review and accept those leads into Clients. Other features may be unavailable, including settings changes, employee access, employee management, Help messages, messaging, and client-data downloads.</p><p><strong>Restoration:</strong> When Stripe confirms payment, the warning and restriction are designed to clear automatically. Processing delays, disputes, reversals, or provider outages may delay restoration.</p></>,
  },
  {
    id: "cancellation",
    title: "6. Cancellation and deletion",
    body: <><p>Owners may manage payment and cancellation through the available Stripe billing controls or contact ARK through Help. Charges already incurred during the current billing period remain due unless ARK issues a credit or applicable law requires otherwise.</p><p>Settings includes a typed-confirmation Delete Account control. When completed successfully, it cancels the active subscription and permanently deletes the active owner account, employee accounts, Contacted You records, Clients, assignments, and supported conversation data. Deleted active data may not be recoverable.</p><p>Download needed information before deletion. ARK may retain limited billing, transaction, usage, security, fraud-prevention, agreement, audit, backup, or legal records where required or permitted by law.</p></>,
  },
  {
    id: "data-export",
    title: "7. Client-data download and retention",
    body: <><p>While an owner account is in good standing, Settings includes Download Client Data, which provides a JSON copy of current Contacted You records, accepted Clients, account details, and Help-message history. Employee accounts do not receive the owner’s full account export.</p><p>ARK may disable downloads while required service charges remain unpaid or the account is payment-restricted. A separate custom export may require additional preparation time or an agreed service charge.</p></>,
  },
  {
    id: "support",
    title: "8. Help and account communication",
    body: <><p>Signed-in owners can open Settings and select Help. Help provides Docs, an in-app AI guide, and Send a Message for technical issues, billing questions, service problems, cancellation, deletion, or other account requests.</p><p>The AI guide can explain how to use the app and provide page links, but it cannot change account data, billing, employees, assignments, leads, conversations, or settings. Employees should contact the owner about access and assignments.</p><p>Signed-in Help messages may be unavailable while the account is payment-restricted. The public Support page remains available when the signed-in app cannot be accessed.</p></>,
  },
  {
    id: "responsibilities",
    title: "9. Customer and employee responsibilities",
    body: <p>Users are responsible for the accuracy and legality of information they provide, their instructions to the Service, the security of login credentials and downloaded files, and their use of customer or lead information. The business must have any notices, permissions, and consents required to collect, record, contact, message, assign, store, export, or process information through the Service. Users may not share credentials improperly, attempt to access unassigned or hidden information, use another person’s employee account, or use the Service for unlawful, fraudulent, abusive, harassing, deceptive, privacy-invasive, or security-invasive activity.</p>,
  },
  {
    id: "ai-output",
    title: "10. Use of information and AI output",
    body: <><p>The Service may organize, summarize, assign, route, or generate information using automated systems. Users remain responsible for reviewing information and deciding how to use it.</p><p>To the maximum extent permitted by law, ARK is not responsible for business decisions, communications, promises, estimates, assignments, actions, or other results based on leads, summaries, recordings, AI output, messages, or customer data made available through the Service. The Service is not a substitute for professional advice.</p></>,
  },
  {
    id: "availability",
    title: "11. Availability and changes to the Service",
    body: <p>ARK works to maintain and test the Service but does not promise uninterrupted or error-free operation. Maintenance, updates, third-party outages, internet, phone, messaging-provider, security, or other circumstances outside ARK’s control may affect availability or delivery. ARK may modify features, providers, workflows, pricing for future periods, or technical requirements when reasonably necessary to maintain, secure, improve, or operate the Service, subject to applicable notice requirements.</p>,
  },
  {
    id: "suspension",
    title: "12. Suspension and termination",
    body: <p>ARK may suspend, restrict, or terminate owner or employee access for nonpayment, misuse, security risk, legal requirements, material breach of these Terms, owner instruction, or conduct that could harm ARK, its providers, customers, or other people. Where reasonable, ARK will provide notice and an opportunity to correct the issue.</p>,
  },
  {
    id: "liability",
    title: "13. Disclaimer and limitation of liability",
    body: <><p>The Service is provided “as is” and “as available” to the extent permitted by law. ARK disclaims implied warranties that may legally be disclaimed, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p><p>To the maximum extent permitted by law, ARK will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, business, goodwill, revenue, or opportunities arising from the Service. ARK’s total liability for a claim will not exceed the amount paid to ARK for the Service during the three months before the event giving rise to the claim. These limits do not apply where applicable law does not allow them.</p></>,
  },
  {
    id: "updates",
    title: "14. Updates and contact",
    body: <><p>ARK may update these Terms as the Service, pricing, employee features, providers, or legal requirements change. The version and effective date appear at the top of this page. If a material update requires new consent, ARK may ask users to accept the revised Terms before continuing.</p><p>Owners can use <strong>Settings → Help → Send a Message</strong> for account-specific questions. Employees should first contact the owner for approval, assignments, or visibility questions. Use the public <Link href="/support" className="font-black underline">Support page</Link> when the signed-in app cannot be accessed.</p></>,
  },
];

export default function TermsPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12"><article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">ARK Client Center</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Terms of Use</h1><p className="mt-3 text-sm font-semibold text-slate-500">Effective {LEGAL_EFFECTIVE_DATE} · Version {TERMS_VERSION}</p></div><div className="flex flex-wrap gap-2"><Link href="/about" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">About</Link><Link href="/support" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Support</Link><Link href="/privacy" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Privacy</Link></div></div><div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-24"><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div></article></main>;
}
