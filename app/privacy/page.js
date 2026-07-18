import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, PRIVACY_VERSION } from "../lib/legal";

const sections = [
  {
    title: "1. What this policy covers",
    body: <p>This Privacy Policy explains how ARK Websites collects, uses, stores, discloses, and deletes information through ARK Client Center and its related receptionist, lead-management, support, and billing services.</p>,
  },
  {
    title: "2. Information we collect",
    body: (
      <>
        <p><strong>Account and business information:</strong> business name, owner or contact name, email address, phone number, account status, plan and billing status, settings, and connection details.</p>
        <p><strong>Customer and lead information:</strong> names, phone numbers, email addresses, addresses, appointment or job details, messages, notes, call or request information, and other content submitted by you, your customers, or connected services.</p>
        <p><strong>Billing information:</strong> Stripe customer, payment-method, invoice, and billing-status identifiers. ARK does not receive or store full card numbers; card details are handled by Stripe.</p>
        <p><strong>Service and technical information:</strong> account activity, usage records, timestamps, device or browser information, error logs, security events, and information needed to operate connected AI, phone, hosting, database, and notification services.</p>
        <p><strong>Support and legal records:</strong> change requests, support messages, cancellation or deletion requests, data-export requests, and records showing when and which version of the Terms of Use and Privacy Policy you accepted.</p>
      </>
    ),
  },
  {
    title: "3. How we use information",
    body: (
      <>
        <p>ARK uses information to create and manage accounts; receive, organize, store, and display leads; operate receptionist and communication features; deliver notifications; process billing; provide support and requested changes; test, maintain, secure, and improve the Service; prevent fraud or abuse; enforce account policies; and comply with legal obligations.</p>
        <p>Customer and lead information may be processed by automated or AI systems to route, summarize, classify, or respond to communications according to the account’s configuration.</p>
      </>
    ),
  },
  {
    title: "4. Who can see information",
    body: (
      <>
        <p>Authorized users of your business account can see information available inside that account.</p>
        <p>Authorized ARK administrators can access account, customer, lead, billing-status, connection, support, and technical information when needed to operate, maintain, test, secure, troubleshoot, support, or administer the Service. This means ARK can see customer data stored in the Service.</p>
        <p>ARK may share information with service providers that help provide the Service, such as cloud database and hosting providers, Stripe, phone or messaging providers, AI providers, email or notification providers, security vendors, and professional advisers. They receive only the information reasonably needed for their role and are subject to their own contractual and legal obligations.</p>
        <p>ARK may also disclose information when required by law, legal process, or a valid government request, or when reasonably necessary to protect rights, safety, security, or prevent fraud and abuse.</p>
      </>
    ),
  },
  {
    title: "5. Sale of information",
    body: <p>ARK does not sell customer or lead information for money. ARK does not use customer or lead information for unrelated third-party advertising.</p>,
  },
  {
    title: "6. Retention and deletion",
    body: (
      <>
        <p>ARK generally retains account and customer data while the account is active and as needed to provide the Service. If an account is disabled, data may remain stored during the applicable payment or deletion grace period.</p>
        <p>You may request account deletion at any time. You may also request a data export before deletion. Once active account data is deleted, it may not be recoverable.</p>
        <p>Limited backup, billing, transaction, security, fraud-prevention, agreement, audit, or legal records may remain for a reasonable period where required or permitted by law, even after active account data is deleted.</p>
      </>
    ),
  },
  {
    title: "7. Security",
    body: <p>ARK uses reasonable administrative, technical, and organizational safeguards designed to protect information. No internet, phone, cloud, or storage system can guarantee absolute security, so you should protect login credentials, limit account access, and notify ARK promptly of suspected misuse.</p>,
  },
  {
    title: "8. Your choices and requests",
    body: (
      <>
        <p>You may request access to, correction of, export of, or deletion of account information through the Request a Change or Priority Support options in Settings. ARK may need to verify identity and account authority before completing a request.</p>
        <p>You may cancel the paid service according to the Terms of Use. Cancellation stops future service and billing according to the applicable billing period, while a separate immediate-deletion request asks ARK to remove the account sooner.</p>
      </>
    ),
  },
  {
    title: "9. Business responsibilities",
    body: <p>Your business is responsible for providing any notices and obtaining any permissions or consents required for the customer, lead, call, message, recording, or other information you submit to or collect through the Service.</p>,
  },
  {
    title: "10. Children",
    body: <p>The Service is intended for businesses and authorized adult users. It is not designed for children to create accounts or submit personal information directly.</p>,
  },
  {
    title: "11. Policy updates",
    body: <p>ARK may update this Privacy Policy as the Service, providers, or legal requirements change. The version and effective date appear at the top of this page. ARK may request renewed acceptance when a material change requires it.</p>,
  },
  {
    title: "12. Contact",
    body: <p>Use the Request a Change or Priority Support options in Settings for privacy questions, access, correction, export, cancellation, or deletion requests.</p>,
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
            <p className="mt-3 text-sm font-semibold text-slate-500">Effective {LEGAL_EFFECTIVE_DATE} · Version {PRIVACY_VERSION}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/terms" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Terms of Use</Link>
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
