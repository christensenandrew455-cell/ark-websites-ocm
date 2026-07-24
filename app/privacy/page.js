import Link from "next/link";
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from "../lib/legal";

const sections = [
  {
    title: "1. What this policy covers",
    body: <p>This Privacy Policy explains how ARK Websites collects, uses, stores, discloses, exports, and deletes information through ARK Client Center and its related AI receptionist, lead-management, messaging, support, website, and billing services.</p>,
  },
  {
    title: "2. Information we collect",
    body: (
      <>
        <p><strong>Account and business information:</strong> business name, owner or contact name, email address, phone number, account identifier, selected Solo plan, account status, settings, connection details, usage information, and payment-restriction status.</p>
        <p><strong>Customer and lead information:</strong> names, phone numbers, email addresses, addresses, requested services, appointment or job details, messages, notes, call or request information, conversation identifiers, and other content submitted by you, your customers, or connected services. This includes records shown in Contacted Me, Clients, and supported lead conversations.</p>
        <p><strong>Billing and usage information:</strong> Stripe customer, payment-method, subscription, meter, charge, invoice, payment-event, amount-due, billing-status, and payment-incident identifiers; the number and timing of unique receptionist leads; and, for Solo Pro, the number and timing of new lead conversations. ARK does not receive or store full card numbers; Stripe handles full card details.</p>
        <p><strong>Service and technical information:</strong> receptionist, AI, phone, messaging, and app usage records, timestamps, device or browser information, notification tokens, error logs, security events, and information needed to operate connected providers.</p>
        <p><strong>Support and legal records:</strong> Help messages, AI-help chat stored on the device for up to 24 hours, public support submissions, cancellation or deletion requests, data-export activity, account-enforcement actions, and records showing when and which version of the Terms of Use and Privacy Policy you accepted.</p>
      </>
    ),
  },
  {
    title: "3. How we use information",
    body: (
      <>
        <p>ARK uses information to create and manage accounts; receive, organize, store, and display leads; operate receptionist and communication features; deliver notifications; measure included usage and overages; process and reconcile Solo and Solo Pro billing; provide support; prepare customer-requested downloads; test, maintain, secure, and improve the Service; prevent fraud or abuse; enforce account policies; and comply with legal obligations.</p>
        <p>Customer and lead information may be processed by automated or AI systems to route, summarize, classify, or respond to communications according to the account’s configuration.</p>
        <p>Stripe payment and usage events may be used automatically to calculate the current billing-period estimate, record lead and conversation usage, show payment notices, place an account in or remove it from payment-restricted mode, and place an unpaid account into manual deletion review. Permanent deletion remains a separate administrator action.</p>
      </>
    ),
  },
  {
    title: "4. What ARK administrators can see",
    body: (
      <>
        <p>Authorized users of your business account can see information available inside that account, subject to the account’s current access level.</p>
        <p>Authorized ARK administrators can access business and owner details, account and connection status, Contacted Me records, accepted Client records, supported conversation records, requested services, appointment details, messages, notes, Help-message history, usage records, plan and billing status, amount-due and payment-incident information, policy-acceptance records, notification status, and technical or security information when needed to operate, maintain, test, secure, troubleshoot, support, bill, enforce, or administer the Service.</p>
        <p>ARK administrators do not receive your account password. ARK also does not receive or store your full payment-card number; Stripe handles full card details.</p>
        <p>Administrative access is intended for providing and protecting the Service, not for unrelated advertising or selling customer information.</p>
      </>
    ),
  },
  {
    title: "5. Service providers and disclosures",
    body: (
      <>
        <p>ARK may share information with service providers that help provide the Service, such as cloud database and hosting providers, Stripe, phone or messaging providers, AI providers, email or notification providers, security vendors, and professional advisers. They receive only the information reasonably needed for their role and are subject to their own contractual and legal obligations.</p>
        <p>ARK may also disclose information when required by law, legal process, or a valid government request, or when reasonably necessary to protect rights, safety, security, or prevent fraud and abuse.</p>
      </>
    ),
  },
  {
    title: "6. Sale of information",
    body: <p>ARK does not sell customer or lead information for money. ARK does not use customer or lead information for unrelated third-party advertising.</p>,
  },
  {
    title: "7. Retention, payment restriction, and deletion",
    body: (
      <>
        <p>ARK generally retains account and customer data while the account is active and as needed to provide the Service. If an account is payment-restricted or waiting for manual deletion review, active data may remain stored so the receptionist can continue receiving leads, payment can be restored, and an administrator can review the account.</p>
        <p>While required service charges remain unpaid or the account is payment-restricted, account features, lead messaging, and client-data downloads may be unavailable. ARK may require payment before preparing or delivering a separate custom export.</p>
        <p><strong>When permanent account deletion is completed, ARK deletes the active business account and active customer records associated with it, including Contacted Me, Clients, and supported conversation data.</strong> Deleted active data may not be recoverable or available for export, so download needed data before deletion.</p>
        <p>Limited backup, billing, transaction, Stripe-event, usage-total, security, fraud-prevention, agreement, audit, or legal records may remain for a reasonable period where required or permitted by law, even after active data is deleted. Backup copies may remain until normal backup rotation completes.</p>
      </>
    ),
  },
  {
    title: "8. Security",
    body: <p>ARK uses reasonable administrative, technical, and organizational safeguards designed to protect information. No internet, phone, cloud, messaging, or storage system can guarantee absolute security, so you should protect login credentials, limit account access, secure downloaded files, and notify ARK promptly of suspected misuse.</p>,
  },
  {
    title: "9. Your choices and requests",
    body: (
      <>
        <p>While the account has full access, you may use Download Client Data in Settings to obtain a JSON copy of current Contacted Me records, accepted Clients, account details, and Help-message history. You may request access, correction, cancellation, or deletion through Settings, Help, and Send a Message.</p>
        <p>ARK may need to verify identity and account authority before completing a request. During payment-restricted mode, restore payment first to regain Settings, signed-in Help messages, messaging, and download features.</p>
        <p>You may cancel the paid service according to the Terms of Use. Cancellation stops future renewal according to the applicable billing period, while a separate immediate-deletion request asks ARK to remove active data sooner.</p>
      </>
    ),
  },
  {
    title: "10. Business responsibilities",
    body: <p>Your business is responsible for providing any notices and obtaining any permissions or consents required for the customer, lead, call, text message, conversation, recording, or other information you submit to or collect through the Service. Your business is also responsible for protecting any client-data file it downloads.</p>,
  },
  {
    title: "11. Children",
    body: <p>The Service is intended for businesses and authorized adult users. It is not designed for children to create accounts or submit personal information directly.</p>,
  },
  {
    title: "12. Policy updates and contact",
    body: (
      <>
        <p>ARK may update this Privacy Policy as the Service, pricing, providers, or legal requirements change. The version and effective date appear at the top of this page. ARK may request renewed acceptance when a material change requires it.</p>
        <p>Use Settings, Help, and Send a Message for account-specific privacy, access, correction, cancellation, or deletion requests. The public <Link href="/support" className="font-black underline">Support page</Link> is available when you cannot access the signed-in app.</p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">ARK Client Center</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Privacy Policy</h1>
            <p className="mt-3 text-sm font-semibold text-slate-500">Effective {PRIVACY_EFFECTIVE_DATE} · Version {PRIVACY_VERSION}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/about" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">About</Link>
            <Link href="/support" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Support</Link>
            <Link href="/terms" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Terms</Link>
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
