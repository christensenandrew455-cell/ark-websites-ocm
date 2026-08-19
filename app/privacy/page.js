import LegalPageHeader, { LegalBackButton } from "../components/LegalPageHeader";
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_VERSION } from "../lib/legal";
import { MESSAGES_AVAILABLE } from "../lib/launchFeatures";

const sections = [
  { title: "What this policy covers", body: <p>This Privacy Policy explains how ARK Websites collects, uses, stores, discloses, exports, and deletes information through ARK Client Center and its related AI receptionist, lead-management{MESSAGES_AVAILABLE ? ", optional messaging" : ""}, support, website, and billing services.</p> },
  {
    title: "Information we collect",
    body: <>
      <p><strong>Account and business information:</strong> business name and normalized business identifier, owner name, email address, phone number, account identifier, optional referring-account identifier, account status, feature settings, connection details, usage information, identity-verification status, and payment-restriction status.</p>
      <p><strong>Customer and lead information:</strong> names, phone numbers, email addresses, addresses, requested services, appointment or job details{MESSAGES_AVAILABLE ? ", messages" : ""}, notes, call or request information{MESSAGES_AVAILABLE ? ", conversation identifiers" : ""}, and other content submitted by the business, customers, or connected services. This includes records shown in Contacted You and Clients{MESSAGES_AVAILABLE ? ", along with lead conversations" : ""}.</p>
      <p><strong>Billing and usage information:</strong> Stripe Customer, SetupIntent, PaymentMethod, subscription, PaymentIntent, coupon, invoice, and payment-event identifiers; the current usage-point balance{MESSAGES_AVAILABLE ? "; rolling SMS-part remainder" : ""}; charge state; last successful payment time; payment-retry and deletion deadlines; and referral qualification. Stripe controls the in-app payment fields, and ARK does not receive or store full card numbers, expiration values, or security codes.</p>
      <p><strong>Service and technical information:</strong> receptionist, AI, phone{MESSAGES_AVAILABLE ? ", messaging" : ""}, and app usage records{MESSAGES_AVAILABLE ? ", SMS-part counts, delivery status, provider message identifiers, and unread counts" : ""}, timestamps, device or browser information, notification tokens, error logs, security events, and information needed to operate connected providers.</p>
      <p><strong>Support and legal records:</strong> Help messages, AI-help chat stored on the device for up to 24 hours, public support submissions, cancellation or deletion actions, data-export activity, account-enforcement actions, and records showing when and which version of the Terms of Use and Privacy Policy was accepted.</p>
    </>,
  },
  {
    title: "How we use information",
    body: <>
      <p>ARK uses information to create and manage business accounts; verify email addresses and phone numbers; validate and qualify referrals; prevent duplicate business identities; enable or disable optional features; receive, organize, store, and display leads; operate receptionist{MESSAGES_AVAILABLE ? " and messaging" : ""} features; deliver notifications; calculate monthly account billing, usage charges, and referral savings; provide support and downloads; test, maintain, secure, and improve the Service; prevent fraud or abuse; enforce account policies; and comply with legal obligations.</p>
      <p>Customer and lead information may be processed by automated or AI systems to route, summarize, classify, or respond to communications according to the account’s configuration.</p>
      <p>Stripe payment events may be used automatically to save the selected payment method, collect the monthly account charge, collect each $20 usage threshold, show payment notices, pause paid services, retry payment, restore service, or delete an account after the seven-day recovery window.</p>
    </>,
  },
  {
    title: "Payment setup",
    body: <><p>During signup, ARK verifies the email address and phone number before collecting business information and opening Stripe’s Payment Element. The Payment Element sends sensitive payment information directly to Stripe. ARK’s server verifies the SetupIntent, starts the $50 monthly subscription, and promotes the temporary signup into a regular account that is already verified.</p><p>The saved payment method is also authorized for later off-session $20 usage charges. Stripe may collect information needed to process the selected payment method under Stripe’s own privacy practices.</p></>,
  },
  ...(MESSAGES_AVAILABLE ? [{
    title: "Messaging and notifications",
    body: <><p>When Messages is enabled, outbound and inbound messaging providers may receive phone numbers, message content, lead and conversation identifiers, SMS-part counts, and delivery information needed to send or receive messages.</p><p>Inbound customer replies may increase unread-message counts and send a device notification to the account owner.</p><p>Notification tokens identify an app installation or device and are used only to deliver account-related alerts. Invalid or unregistered tokens may be deleted automatically.</p></>,
  }] : []),
  {
    title: "What ARK administrators can see",
    body: <><p>Authorized ARK administrators can access business and owner details; account, connection, and feature status; Contacted You and Client records{MESSAGES_AVAILABLE ? "; conversation records" : ""}; requested services; appointment details; notes{MESSAGES_AVAILABLE ? " and messages" : ""}; Help history; usage and billing records; policy-acceptance records; notification status; and technical or security information when needed to operate, maintain, test, secure, troubleshoot, support, bill, enforce, or administer the Service.</p><p>ARK administrators do not receive account passwords or full payment-card details.</p><p>Administrative access is intended for providing and protecting the Service, not for unrelated advertising or selling customer information.</p></>,
  },
  {
    title: "Service providers and disclosures",
    body: <><p>ARK may share information with service providers that help provide the Service, such as cloud database and hosting providers, Stripe, phone{MESSAGES_AVAILABLE ? " or messaging" : ""} providers, AI providers, email or notification providers, security vendors, and professional advisers. They receive only the information reasonably needed for their role and are subject to their own contractual and legal obligations.</p><p>ARK may also disclose information when required by law, legal process, or a valid government request, or when reasonably necessary to protect rights, safety, security, or prevent fraud and abuse.</p></>,
  },
  { title: "Sale of information", body: <p>ARK does not sell customer, lead, owner, or account information for money. ARK does not use that information for unrelated third-party advertising.</p> },
  {
    title: "Retention, payment restriction, and deletion",
    body: <><p>ARK generally retains account and customer data{MESSAGES_AVAILABLE ? ", including conversation data," : ""} while the account is active and as needed to provide the Service. Owners may choose Never, 1 day, 1 week, or 1 month auto-delete settings for Leads{MESSAGES_AVAILABLE ? " and Messages" : ""}.</p><p>A declined payment immediately pauses the receptionist and new lead intake{MESSAGES_AVAILABLE ? ", along with messaging" : ""}. The owner retains payment-update access during a seven-day recovery window. If payment remains incomplete, the account and active data are designed to be permanently deleted.</p><p><strong>When the owner completes the typed-confirmation Delete Account control, ARK is designed to cancel the active subscription and delete the active account, Contacted You records, and Clients{MESSAGES_AVAILABLE ? ", along with supported conversation data" : ""}.</strong> Deleted active data may not be recoverable or available for export, so download needed data first.</p><p>Limited backup, billing, transaction, Stripe-event, usage-total, security, fraud-prevention, agreement, audit, deletion-audit, or legal records may remain for a reasonable period where required or permitted by law. Backup copies may remain until normal backup rotation completes.</p></>,
  },
  { title: "Security", body: <p>ARK uses reasonable administrative, technical, and organizational safeguards designed to protect information. Account access is filtered by authentication, account status, and server-side authorization. No internet, phone, cloud{MESSAGES_AVAILABLE ? ", messaging" : ""}, or storage system can guarantee absolute security, so users should protect credentials, avoid sharing accounts, secure downloaded files, and notify ARK promptly of suspected misuse.</p> },
  {
    title: "Your choices and requests",
    body: <><p>While an account has full access, the owner may turn optional features on or off, choose Leads{MESSAGES_AVAILABLE ? " and Messages" : ""} auto-delete settings, use Download Client Data, update payment information through Stripe, or permanently delete the account through Settings.</p><p>ARK may need to verify identity and account authority before completing support requests. During payment-restricted mode, restore payment first to regain settings, signed-in Help messages{MESSAGES_AVAILABLE ? ", messaging" : ""}, and download features.</p></>,
  },
  { title: "Business responsibilities", body: <p>The business is responsible for providing notices and obtaining permissions or consents required for customer, lead, call{MESSAGES_AVAILABLE ? ", text-message, conversation" : ""}, recording, or other information submitted to or collected through the Service. The business is also responsible for protecting login credentials and downloaded data.</p> },
  { title: "Children", body: <p>The Service is intended for businesses and authorized adults. It is not designed for children to create accounts or submit personal information directly.</p> },
  {
    title: "Policy updates and contact",
    body: <><p>ARK may update this Privacy Policy as the Service, pricing, providers, or legal requirements change. The version and effective date appear at the top of this page. ARK may request renewed acceptance when a material change requires it.</p><p>Owners can use Settings, Help, and Send a Message for account-specific privacy, access, correction, or billing requests.</p></>,
  },
];

export default function PrivacyPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12"><div className="mx-auto max-w-4xl"><div className="mb-4"><LegalBackButton /></div><article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><LegalPageHeader title="Privacy Policy" effectiveDate={PRIVACY_EFFECTIVE_DATE} version={PRIVACY_VERSION} active="privacy" /><div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section, index) => <section key={section.title}><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{index + 1}. {section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div></article></div></main>;
}
