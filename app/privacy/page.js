import Link from "next/link";
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from "../lib/legal";

const sections = [
  {
    title: "1. What this policy covers",
    body: <p>This Privacy Policy explains how ARK Websites collects, uses, stores, discloses, exports, and deletes information through ARK Client Center and its related AI receptionist, lead-management, employee, assignment, messaging, support, website, and billing services.</p>,
  },
  {
    title: "2. Information we collect",
    body: (
      <>
        <p><strong>Account and business information:</strong> business name and normalized business-name identifier, owner or employee name, email address, phone number, account identifier, account type, selected plan, account and approval status, settings, connection details, usage information, and payment-restriction status.</p>
        <p><strong>Employee and access information:</strong> employee membership requests, owner approval or disabling actions, active-seat status, assigned leads or clients, assignment timestamps, employee visibility settings, and records showing which employee was permitted to view or work with a lead.</p>
        <p><strong>Customer and lead information:</strong> names, phone numbers, email addresses, addresses, requested services, appointment or job details, messages, notes, call or request information, conversation identifiers, assignments, and other content submitted by your business, customers, employees, or connected services. This includes records shown in Contacted Me, Clients, and lead conversations.</p>
        <p><strong>Billing and usage information:</strong> Stripe customer, payment-method, subscription, meter, charge, invoice, payment-event, amount-due, billing-status, and payment-incident identifiers; lead and conversation totals; and, for Business, active employee-seat totals. ARK does not receive or store full card numbers; Stripe handles full card details.</p>
        <p><strong>Service and technical information:</strong> receptionist, AI, phone, messaging, and app usage records, delivery status, provider message identifiers, timestamps, device or browser information, notification tokens, error logs, security events, and information needed to operate connected providers.</p>
        <p><strong>Support and legal records:</strong> Help messages, AI-help chat stored on the device for up to 24 hours, public support submissions, cancellation or deletion requests, data-export activity, account-enforcement actions, and records showing when and which version of the Terms of Use and Privacy Policy a user accepted.</p>
      </>
    ),
  },
  {
    title: "3. How we use information",
    body: (
      <>
        <p>ARK uses information to create and manage owner and employee accounts; prevent duplicate business identities; approve or restrict access; receive, organize, store, display, and assign leads; operate receptionist and messaging features; deliver notifications; measure included usage and overages; process and reconcile Solo, Solo Pro, and Business billing; provide support and downloads; test, maintain, secure, and improve the Service; prevent fraud or abuse; enforce account policies; and comply with legal obligations.</p>
        <p>Customer and lead information may be processed by automated or AI systems to route, summarize, classify, assign, or respond to communications according to the account’s configuration.</p>
        <p>Stripe payment and usage events may be used automatically to calculate billing estimates, record lead, conversation, and active employee usage, show payment notices, restrict owner or employee access, and place an unpaid account into manual deletion review. Permanent deletion remains a separate administrator action.</p>
      </>
    ),
  },
  {
    title: "4. Business-owner and employee access",
    body: (
      <>
        <p>Business owners can approve, disable, or reactivate employee accounts, assign leads and clients, and choose which categories of lead information employees can see. Those settings may cover names, phone numbers, email addresses, addresses, requested work, requested dates or times, and notes.</p>
        <p>Approved employees are intended to receive only records assigned to them and only the fields enabled by the owner. Employee-facing requests are processed through filtered server endpoints rather than granting employees direct access to the full business database.</p>
        <p>The business owner is responsible for making appropriate access choices and promptly disabling users who should no longer have access. ARK may preserve approval, assignment, access, and security records where reasonably needed to administer or protect the Service.</p>
      </>
    ),
  },
  {
    title: "5. What ARK administrators can see",
    body: (
      <>
        <p>Authorized ARK administrators can access business, owner, and employee details; account, approval, connection, and assignment status; Contacted Me and Client records; conversation records; requested services; appointment details; messages and notes; Help history; usage and billing records; visibility settings; policy-acceptance records; notification status; and technical or security information when needed to operate, maintain, test, secure, troubleshoot, support, bill, enforce, or administer the Service.</p>
        <p>ARK administrators do not receive account passwords. ARK also does not receive or store full payment-card numbers; Stripe handles full card details.</p>
        <p>Administrative access is intended for providing and protecting the Service, not for unrelated advertising or selling customer information.</p>
      </>
    ),
  },
  {
    title: "6. Service providers and disclosures",
    body: (
      <>
        <p>ARK may share information with service providers that help provide the Service, such as cloud database and hosting providers, Stripe, phone or messaging providers, AI providers, email or notification providers, security vendors, and professional advisers. They receive only the information reasonably needed for their role and are subject to their own contractual and legal obligations.</p>
        <p>Outbound and inbound messaging providers may receive phone numbers, message content, lead and conversation identifiers, and delivery information needed to send or receive messages.</p>
        <p>ARK may also disclose information when required by law, legal process, or a valid government request, or when reasonably necessary to protect rights, safety, security, or prevent fraud and abuse.</p>
      </>
    ),
  },
  {
    title: "7. Sale of information",
    body: <p>ARK does not sell customer, lead, owner, or employee information for money. ARK does not use that information for unrelated third-party advertising.</p>,
  },
  {
    title: "8. Retention, payment restriction, and deletion",
    body: (
      <>
        <p>ARK generally retains owner, employee, assignment, customer, and conversation data while the account is active and as needed to provide the Service. If an account is payment-restricted or waiting for manual deletion review, active data may remain stored so the receptionist can continue receiving leads, payment can be restored, and an administrator can review the account.</p>
        <p>While required service charges remain unpaid or the account is payment-restricted, owner features, employee access, employee management, lead messaging, and client-data downloads may be unavailable.</p>
        <p><strong>When permanent account deletion is completed, ARK deletes the active business account and active records associated with it, including employee memberships, assignments, Contacted Me, Clients, and supported conversation data.</strong> Deleted active data may not be recoverable or available for export, so download needed data before deletion.</p>
        <p>Limited backup, billing, transaction, Stripe-event, usage-total, employee-seat, security, fraud-prevention, agreement, audit, or legal records may remain for a reasonable period where required or permitted by law, even after active data is deleted. Backup copies may remain until normal backup rotation completes.</p>
      </>
    ),
  },
  {
    title: "9. Security",
    body: <p>ARK uses reasonable administrative, technical, and organizational safeguards designed to protect information. Employee access is filtered by account status, assignment, and owner visibility settings. No internet, phone, cloud, messaging, or storage system can guarantee absolute security, so users should protect credentials, avoid sharing accounts, limit access, secure downloaded files, and notify ARK or the business owner promptly of suspected misuse.</p>,
  },
  {
    title: "10. Your choices and requests",
    body: (
      <>
        <p>While an owner account has full access, the owner may use Download Client Data in Settings and may request access, correction, cancellation, or deletion through Settings, Help, and Send a Message. Employees can ask the business owner to correct employee details, assignments, or access settings.</p>
        <p>ARK may need to verify identity and account authority before completing a request. Business owners can approve, disable, or reactivate employee accounts. During payment-restricted mode, restore payment first to regain owner settings, employee access, signed-in Help messages, messaging, and download features.</p>
        <p>Cancellation stops future renewal according to the applicable billing period, while a separate immediate-deletion request asks ARK to remove active data sooner.</p>
      </>
    ),
  },
  {
    title: "11. Business responsibilities",
    body: <p>Your business is responsible for providing notices and obtaining permissions or consents required for customer, lead, employee, call, text-message, conversation, recording, assignment, or other information submitted to or collected through the Service. The business is also responsible for choosing appropriate employee access and protecting downloaded data.</p>,
  },
  {
    title: "12. Children",
    body: <p>The Service is intended for businesses and authorized adult users. It is not designed for children to create owner or employee accounts or submit personal information directly.</p>,
  },
  {
    title: "13. Policy updates and contact",
    body: (
      <>
        <p>ARK may update this Privacy Policy as the Service, pricing, employee features, providers, or legal requirements change. The version and effective date appear at the top of this page. ARK may request renewed acceptance when a material change requires it.</p>
        <p>Owners can use Settings, Help, and Send a Message for account-specific privacy, access, correction, cancellation, or deletion requests. Employees should contact the business owner for employee-access or assignment questions. The public <Link href="/support" className="font-black underline">Support page</Link> is available when the signed-in app cannot be accessed.</p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">ARK Client Center</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Privacy Policy</h1><p className="mt-3 text-sm font-semibold text-slate-500">Effective {PRIVACY_EFFECTIVE_DATE} · Version {PRIVACY_VERSION}</p></div>
          <div className="flex flex-wrap gap-2"><Link href="/about" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">About</Link><Link href="/support" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Support</Link><Link href="/terms" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Terms</Link></div>
        </div>
        <div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section) => <section key={section.title}><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div>
      </article>
    </main>
  );
}
