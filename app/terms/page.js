import LegalPageHeader, { LegalBackButton } from "../components/LegalPageHeader";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "../lib/legal";
import { MESSAGES_AVAILABLE } from "../lib/launchFeatures";

const sections = [
  {
    id: "agreement",
    title: "Agreement to these Terms",
    body: <><p>These Terms of Use govern access to ARK Client Center and the related AI receptionist, lead-management{MESSAGES_AVAILABLE ? ", optional messaging" : ""}, storage, support, website, billing, and account services provided by ARK Websites (collectively, the “Service”). By creating an account, accepting the agreement, adding a payment method, enabling a feature, or continuing to use the Service, you agree to these Terms and the Privacy Policy.</p><p>The account owner represents that they are an adult and have authority to accept these Terms for the business.</p></>,
  },
  {
    id: "paid-service",
    title: "Payment method and monthly accepted-lead plans",
    body: <>
      <p>During signup, the payment provider securely confirms payment inside the Service. The iOS app uses Apple In-App Purchase; web and other supported platforms use Stripe. After the provider confirms payment, ARK starts the selected monthly subscription and its first recurring charge may be collected immediately.</p>
      <p><strong>Starter:</strong> $24.99 USD per monthly billing period for up to 25 accepted leads.</p>
      <p><strong>Standard:</strong> $47.49 USD per monthly billing period for up to 50 accepted leads, shown as 5% savings compared with $1 per accepted lead.</p>
      <p><strong>Growth:</strong> $89.99 USD per monthly billing period for up to 100 accepted leads, shown as 10% savings compared with $1 per accepted lead.</p>
      <p><strong>Scale:</strong> $169.99 USD per monthly billing period for up to 200 accepted leads, shown as 15% savings compared with $1 per accepted lead.</p>
      <p><strong>What counts as an accepted lead:</strong> Each unique service request counts once when the business owner taps Accept. Repeated acceptance attempts do not count again. Calls, declined leads, edits, retention, and deletion do not count.</p>
      <p><strong>Monthly limit:</strong> At the start of each new billing period, the allowance resets to exactly the selected plan’s included amount: 25, 50, 100, or 200. Unused accepted leads do not roll over or increase the next period’s allowance.</p>
      <p><strong>Additional accepted leads:</strong> An owner may purchase a custom whole-number quantity of additional accepted leads for the current billing period at $1 USD per lead, with no volume discount. Top-up leads expire at the next allowance reset and do not roll over.</p>
      <p><strong>Plan changes:</strong> Stripe-billed owners may schedule a different plan for the next renewal with no immediate charge, or switch immediately by paying the new plan price and beginning a fresh billing period. An immediate switch does not refund, credit, or carry over unused leads from the prior plan. Apple controls the effective date, charge, and proration treatment for App Store plan changes and displays those terms before confirmation.</p>
      <p><strong>Payment display:</strong> Settings shows only the current plan, accepted leads used and remaining, top-ups, billing-period end date, and payment method. Manage Plan &amp; Payment contains the available plans, explicit change confirmation, top-up purchase, and payment-method control. Apple’s or Stripe’s payment records control completed purchases and charges.</p>
      <p>Custom work, provider pass-through charges, taxes, or other fees apply only when separately disclosed or agreed. An account-specific written agreement controls if it expressly differs from these general pricing terms.</p>
    </>,
  },
  ...(MESSAGES_AVAILABLE ? [{
    id: "messages",
    title: "Optional Messages feature",
    body: <><p>The owner can turn Messages on or off in Settings. Turning it off removes access to the workspace.</p><p>Deleting a chat blocks ARK from reopening, sending, recording, or notifying for later messages from that phone number. It does not create a carrier-level opt-out on the other person’s phone and cannot guarantee that a telecommunications provider will not receive or separately charge for an inbound message.</p><p>ARK may temporarily prevent feature changes while an account is payment-restricted, disabled, under security review, or affected by a provider outage.</p></>,
  }] : []),
  {
    id: "payment-enforcement",
    title: "Payment failures and account enforcement",
    body: <><p><strong>Immediate pause:</strong> When a recurring subscription payment fails, ARK immediately disables the AI receptionist and new lead intake. The owner may still sign in and manage billing.</p><p><strong>Seven-day recovery window:</strong> For Stripe-billed accounts, ARK displays “You need to update your payment method,” retries an eligible charge no more than once per day, and keeps the account paused for up to seven days after the first failure. Apple controls its subscription billing-retry schedule; Apple-billed accounts remain paused until Apple confirms recovery and are not automatically deleted solely because seven days elapsed.</p><p><strong>Deletion:</strong> If an eligible Stripe payment is not completed by the end of the seven-day recovery window, ARK is designed to end associated service and permanently delete the account and its active data. Deleted data may not be recoverable.</p><p><strong>Restoration:</strong> When Apple or Stripe confirms the required subscription payment, ARK restores the account, receptionist, and connection automatically. Processing delays, disputes, reversals, or provider outages may delay restoration.</p></>,
  },
  {
    id: "cancellation",
    title: "Cancellation and deletion",
    body: <><p>Owners may manage an Apple subscription through Apple’s subscription settings, manage Stripe billing through the available Stripe controls, or contact ARK through Help. Charges already incurred during the current billing period remain due unless the payment provider or ARK issues a credit or applicable law requires otherwise.</p><p>Settings includes a typed-confirmation Delete Account control. Apple-billed owners should cancel the Apple subscription in Apple’s settings before deleting the ARK account because deleting an ARK account does not itself cancel billing controlled by Apple. Account deletion permanently removes the active account, Contacted You records, Clients{MESSAGES_AVAILABLE ? ", and supported conversation data" : ""}. Deleted active data may not be recoverable.</p><p>Download needed information before deletion. ARK may retain limited billing, transaction, call-total, security, fraud-prevention, agreement, audit, backup, or legal records where required or permitted by law.</p></>,
  },
  {
    id: "data-export",
    title: "Client-data download and retention",
    body: <><p>While an account is in good standing, Settings includes Download Client Data, which provides a JSON copy of current Contacted You records, accepted Clients, account details, and Help-message history.</p><p>ARK may disable downloads while required service charges remain unpaid or the account is payment-restricted. A separate custom export may require additional preparation time or an agreed service charge.</p></>,
  },
  {
    id: "support",
    title: "Help and account communication",
    body: <><p>Signed-in owners can open Settings and select Help. Help provides Docs, an in-app AI guide, Give Feedback when available, and Send a Message for technical issues, billing questions, service problems, cancellation, deletion, or other account requests.</p><p>The AI guide can explain how to use the app and provide page links, but it cannot change account data, billing, leads, conversations, or settings.</p></>,
  },
  {
    id: "responsibilities",
    title: "Business responsibilities",
    body: <p>Users are responsible for the accuracy and legality of information they provide, their instructions to the Service, the security of login credentials and downloaded files, and their use of customer or lead information. The business must have any notices, permissions, and consents required to collect, record, contact{MESSAGES_AVAILABLE ? ", message" : ""}, store, export, or process information through the Service. Users may not share credentials improperly, attempt to access another account, or use the Service for unlawful, fraudulent, abusive, harassing, deceptive, privacy-invasive, or security-invasive activity.</p>,
  },
  {
    id: "ai-output",
    title: "Use of information and AI output",
    body: <><p>The Service may organize, summarize, route, or generate information using automated systems. Users remain responsible for reviewing information and deciding how to use it.</p><p>To the maximum extent permitted by law, ARK is not responsible for business decisions, communications, promises, estimates, actions, or other results based on leads, summaries, recordings, AI output{MESSAGES_AVAILABLE ? ", messages" : ""}, or customer data made available through the Service. The Service is not a substitute for professional advice.</p></>,
  },
  {
    id: "availability",
    title: "Availability and changes to the Service",
    body: <p>ARK works to maintain and test the Service but does not promise uninterrupted or error-free operation. Maintenance, updates, third-party outages, internet, phone{MESSAGES_AVAILABLE ? ", messaging-provider" : ""}, security, or other circumstances outside ARK’s control may affect availability or delivery. ARK may modify features, providers, workflows, pricing for future periods, or technical requirements when reasonably necessary to maintain, secure, improve, or operate the Service, subject to applicable notice requirements.</p>,
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    body: <p>ARK may suspend, restrict, or terminate account access for nonpayment, misuse, security risk, legal requirements, material breach of these Terms, or conduct that could harm ARK, its providers, customers, or other people. Where reasonable, ARK will provide notice and an opportunity to correct the issue.</p>,
  },
  {
    id: "liability",
    title: "Disclaimer and limitation of liability",
    body: <><p>The Service is provided “as is” and “as available” to the extent permitted by law. ARK disclaims implied warranties that may legally be disclaimed, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p><p>To the maximum extent permitted by law, ARK will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, business, goodwill, revenue, or opportunities arising from the Service. ARK’s total liability for a claim will not exceed the amount paid to ARK for the Service during the three months before the event giving rise to the claim. These limits do not apply where applicable law does not allow them.</p></>,
  },
  {
    id: "updates",
    title: "Updates and contact",
    body: <><p>ARK may update these Terms as the Service, pricing, providers, or legal requirements change. The version and effective date appear at the top of this page. If a material update requires new consent, ARK may ask users to accept the revised Terms before continuing.</p><p>Owners can use <strong>Settings → Help → Send a Message</strong> for account-specific questions.</p></>,
  },
];

export default function TermsPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12"><div className="mx-auto max-w-4xl"><div className="mb-4"><LegalBackButton /></div><article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><LegalPageHeader title="Terms of Use" effectiveDate={LEGAL_EFFECTIVE_DATE} version={TERMS_VERSION} active="terms" /><div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section, index) => <section key={section.id} id={section.id} className="scroll-mt-24"><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{index + 1}. {section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div></article></div></main>;
}
