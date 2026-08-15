import LegalPageHeader from "../components/LegalPageHeader";
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from "../lib/legal";

const sections = [
  { title: "1. What this policy covers", body: <p>This Privacy Policy explains how ARK Websites collects, uses, stores, discloses, exports, and deletes information through ARK Client Center and its related AI receptionist, lead-management, optional messaging, support, website, and billing services.</p> },
  {
    title: "2. Information we collect",
    body: <>
      <p><strong>Account and business information:</strong> business name and normalized business identifier, owner name, email address, phone number, account identifier, optional referring-account identifier, account status, feature settings, connection details, usage information, identity-verification status, and payment-restriction status.</p>
      <p><strong>Customer and lead information:</strong> names, phone numbers, email addresses, addresses, requested services, appointment or job details, messages, notes, call or request information, conversation identifiers, and other content submitted by the business, customers, or connected services. This includes records shown in Contacted You, Clients, and lead conversations.</p>
      <p><strong>Billing and usage information:</strong> Stripe Customer, SetupIntent, PaymentMethod, subscription, meter, coupon, charge, invoice, payment-event, amount-due, billing-status, referral-qualification, and payment-incident identifiers; new-lead event totals; new-chat totals; rolling SMS message-part totals; and referral discounts. Stripe controls the in-app payment fields, and ARK does not receive or store full card numbers, expiration values, or security codes.</p>
      <p><strong>Service and technical information:</strong> receptionist, AI, phone, messaging, and app usage records, SMS-part counts, delivery status, provider message identifiers, timestamps, device or browser information, notification tokens, unread counts, error logs, security events, and information needed to operate connected providers.</p>
      <p><strong>Support and legal records:</strong> Help messages, AI-help chat stored on the device for up to 24 hours, public support submissions, cancellation or deletion actions, data-export activity, account-enforcement actions, and records showing when and which version of the Terms of Use and Privacy Policy was accepted.</p>
    </>,
  },
  {
    title: "3. How we use information",
    body: <>
      <p>ARK uses information to create and manage business accounts; verify email addresses and phone numbers; validate and qualify referrals; prevent duplicate business identities; enable or disable optional features; receive, organize, store, and display leads; operate receptionist and messaging features; deliver notifications; calculate monthly account billing, usage charges, and referral savings; provide support and downloads; test, maintain, secure, and improve the Service; prevent fraud or abuse; enforce account policies; and comply with legal obligations.</p>
      <p>Customer and lead information may be processed by automated or AI systems to route, summarize, classify, or respond to communications according to the account’s configuration.</p>
      <p>Stripe payment and usage events may be used automatically to save the owner’s selected payment method, calculate billing estimates, record call, chat, and SMS-part usage, show payment notices, restrict account access, and place an unpaid account into manual review.</p>
    </>,
  },
  {
    title: "4. Payment setup",
    body: <><p>During signup, Stripe’s Payment Element appears inside ARK Client Center and sends sensitive payment information directly to Stripe. ARK’s server creates the SetupIntent for the signed-in account’s Stripe Customer and verifies the result before activating the account.</p><p>The signup payment screen saves a payment method for future recurring and off-session billing; it does not charge the payment method on that screen. Stripe may collect information needed to process the selected payment method under Stripe’s own privacy practices.</p></>,
  },
  {
    title: "5. Messaging and notifications",
    body: <><p>When Messages is enabled, outbound and inbound messaging providers may receive phone numbers, message content, lead and conversation identifiers, SMS-part counts, and delivery information needed to send or receive messages.</p><p>Inbound customer replies may increase unread-message counts and send a device notification to the account owner.</p><p>Notification tokens identify an app installation or device and are used only to deliver account-related alerts. Invalid or unregistered tokens may be deleted automatically.</p></>,
  },
  {
    title: "6. What ARK administrators can see",
    body: <><p>Authorized ARK administrators can access business and owner details; account, connection, and feature status; Contacted You and Client records; conversation records; requested services; appointment details; messages and notes; Help history; usage and billing records; policy-acceptance records; notification status; and technical or security information when needed to operate, maintain, test, secure, troubleshoot, support, bill, enforce, or administer the Service.</p><p>ARK administrators do not receive account passwords or full payment-card details.</p><p>Administrative access is intended for providing and protecting the Service, not for unrelated advertising or selling customer information.</p></>,
  },
  {
    title: "7. Service providers and disclosures",
    body: <><p>ARK may share information with service providers that help provide the Service, such as cloud database and hosting providers, Stripe, phone or messaging providers, AI providers, email or notification providers, security vendors, and professional advisers. They receive only the information reasonably needed for their role and are subject to their own contractual and legal obligations.</p><p>ARK may also disclose information when required by law, legal process, or a valid government request, or when reasonably necessary to protect rights, safety, security, or prevent fraud and abuse.</p></>,
  },
  { title: "8. Sale of information", body: <p>ARK does not sell customer, lead, owner, or account information for money. ARK does not use that information for unrelated third-party advertising.</p> },
  {
    title: "9. Retention, payment restriction, and deletion",
    body: <><p>ARK generally retains account, customer, and conversation data while the account is active and as needed to provide the Service. Owners may separately choose Never, 1 day, 1 week, or 1 month auto-delete settings for Leads and Messages.</p><p>While required service charges remain unpaid or the account is payment-restricted, settings, Help messages, lead messaging, and client-data downloads may be unavailable.</p><p><strong>When the owner completes the typed-confirmation Delete Account control, ARK is designed to cancel the active subscription and delete the active account, Contacted You records, Clients, and supported conversation data.</strong> Deleted active data may not be recoverable or available for export, so download needed data first.</p><p>Limited backup, billing, transaction, Stripe-event, usage-total, security, fraud-prevention, agreement, audit, deletion-audit, or legal records may remain for a reasonable period where required or permitted by law. Backup copies may remain until normal backup rotation completes.</p></>,
  },
  { title: "10. Security", body: <p>ARK uses reasonable administrative, technical, and organizational safeguards designed to protect information. Account access is filtered by authentication, account status, and server-side authorization. No internet, phone, cloud, messaging, or storage system can guarantee absolute security, so users should protect credentials, avoid sharing accounts, secure downloaded files, and notify ARK promptly of suspected misuse.</p> },
  {
    title: "11. Your choices and requests",
    body: <><p>While an account has full access, the owner may turn optional features on or off, choose Leads and Messages auto-delete settings, use Download Client Data, update payment information through Stripe, or permanently delete the account through Settings.</p><p>ARK may need to verify identity and account authority before completing support requests. During payment-restricted mode, restore payment first to regain settings, signed-in Help messages, messaging, and download features.</p></>,
  },
  { title: "12. Business responsibilities", body: <p>The business is responsible for providing notices and obtaining permissions or consents required for customer, lead, call, text-message, conversation, recording, or other information submitted to or collected through the Service. The business is also responsible for protecting login credentials and downloaded data.</p> },
  { title: "13. Children", body: <p>The Service is intended for businesses and authorized adults. It is not designed for children to create accounts or submit personal information directly.</p> },
  {
    title: "14. Policy updates and contact",
    body: <><p>ARK may update this Privacy Policy as the Service, pricing, providers, or legal requirements change. The version and effective date appear at the top of this page. ARK may request renewed acceptance when a material change requires it.</p><p>Owners can use Settings, Help, and Send a Message for account-specific privacy, access, correction, or billing requests.</p></>,
  },
];

export default function PrivacyPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12"><article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><LegalPageHeader title="Privacy Policy" effectiveDate={PRIVACY_EFFECTIVE_DATE} version={PRIVACY_VERSION} active="privacy" /><div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section) => <section key={section.title}><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div></article></main>;
}
