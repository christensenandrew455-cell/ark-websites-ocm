import LegalPageHeader, { LegalBackButton } from "../components/LegalPageHeader";
import { LEGAL_EFFECTIVE_DATE, TERMS_VERSION } from "../lib/legal";

const sections = [
  {
    id: "agreement",
    title: "1. Agreement to these Terms",
    body: <><p>These Terms of Use govern access to ARK Client Center and the related AI receptionist, lead-management, optional messaging, storage, support, website, billing, and account services provided by ARK Websites (collectively, the “Service”). By creating an account, accepting the agreement, adding a payment method, enabling a feature, or continuing to use the Service, you agree to these Terms and the Privacy Policy.</p><p>The account owner represents that they are an adult and have authority to accept these Terms for the business.</p></>,
  },
  {
    id: "paid-service",
    title: "2. Payment method, monthly account, and usage charges",
    body: <>
      <p>During signup, Stripe securely collects and saves a payment method inside the Service. After Stripe confirms that method, ARK starts the monthly subscription and the initial $50 monthly charge may be collected immediately. The owner authorizes Stripe to use the saved payment method for recurring account fees, threshold-based usage, applicable taxes, and other charges separately agreed in writing.</p>
      <p><strong>Monthly account:</strong> $50 USD per monthly billing period for one business account and its AI receptionist workspace.</p>
      <p><strong>Usage points:</strong> Reviewing a lead in Contacted You is free. Accepting the lead adds two points ($2), while declining it adds no points. When Messages is enabled, the combined rolling inbound-and-outbound SMS counter adds one point ($1) whenever it completes another 50 parts. Starting a chat does not add a separate charge. Partial SMS-part progress carries forward, and long messages may use more than one SMS part.</p>
      <p><strong>$20 usage threshold:</strong> ARK charges exactly $20 whenever the saved usage balance reaches or exceeds 20 points. Any points above 20 carry into the next interval. For example, a 19-point balance followed by a two-point lead results in one $20 charge and a new one-point balance.</p>
      <p><strong>Recorded usage:</strong> Deleting an accepted client, chat, or message does not remove valid accepted-lead or completed SMS-part usage already incurred.</p>
      <p><strong>What counts as a lead:</strong> Each newly received estimate request or other connected intake submission creates one durable lead event. Moving, editing, retaining, or deleting that lead does not create another charge or erase the original event. Duplicate events caused solely by a verified system error may be corrected by ARK.</p>
      <p><strong>Referrals:</strong> When a new paid account enters an eligible referring account ID and activates, the referring account receives 10% off usage charges for 30 days from that activation. Active referral savings combine up to 50%. Referral savings do not reduce the $50 recurring charge, cannot reduce a usage charge below zero, and may be withheld or reversed for duplicate, self, invalid, fraudulent, canceled, refunded, or otherwise ineligible accounts.</p>
      <p><strong>Payment display:</strong> Settings shows the $50 monthly rate, current usage balance out of $20, SMS-part progress, the saved payment method, and the last successful payment time. Stripe’s payment records control completed charges.</p>
      <p>Custom work, provider pass-through charges, taxes, or other fees apply only when separately disclosed or agreed. An account-specific written agreement controls if it expressly differs from these general pricing terms.</p>
    </>,
  },
  {
    id: "messages",
    title: "3. Optional Messages feature",
    body: <><p>The owner can turn Messages on or off in Settings. Turning it off removes access to the workspace but does not reverse valid usage already incurred.</p><p>Deleting a chat blocks ARK from reopening, sending, recording, notifying, or adding ARK billing usage for later messages from that phone number. It does not create a carrier-level opt-out on the other person’s phone and cannot guarantee that a telecommunications provider will not receive or separately charge for an inbound message.</p><p>ARK may temporarily prevent feature changes while an account is payment-restricted, disabled, under security review, or affected by a provider outage.</p></>,
  },
  {
    id: "payment-enforcement",
    title: "4. Payment failures and account enforcement",
    body: <><p><strong>Immediate pause:</strong> When a monthly or $20 usage payment is declined, ARK immediately disables the AI receptionist, new lead intake, and inbound and outbound chat. The owner may still sign in and update the payment method.</p><p><strong>Seven-day recovery window:</strong> ARK displays “You need to update your payment method,” retries an eligible unpaid charge no more than once per day, and keeps the account paused for up to seven days after the first failure.</p><p><strong>Deletion:</strong> If payment is not completed by the end of the seven-day recovery window, ARK is designed to cancel associated service and permanently delete the account and its active data. Deleted data may not be recoverable.</p><p><strong>Restoration:</strong> When Stripe confirms the required payment, ARK restores the account, receptionist, connection, and available messaging automatically. Processing delays, disputes, reversals, or provider outages may delay restoration.</p></>,
  },
  {
    id: "cancellation",
    title: "5. Cancellation and deletion",
    body: <><p>Owners may manage payment and cancellation through the available Stripe billing controls or contact ARK through Help. Charges already incurred during the current billing period remain due unless ARK issues a credit or applicable law requires otherwise.</p><p>Settings includes a typed-confirmation Delete Account control. When completed successfully, it cancels the active subscription and permanently deletes the active account, Contacted You records, Clients, and supported conversation data. Deleted active data may not be recoverable.</p><p>Download needed information before deletion. ARK may retain limited billing, transaction, usage, security, fraud-prevention, agreement, audit, backup, or legal records where required or permitted by law.</p></>,
  },
  {
    id: "data-export",
    title: "6. Client-data download and retention",
    body: <><p>While an account is in good standing, Settings includes Download Client Data, which provides a JSON copy of current Contacted You records, accepted Clients, account details, and Help-message history.</p><p>ARK may disable downloads while required service charges remain unpaid or the account is payment-restricted. A separate custom export may require additional preparation time or an agreed service charge.</p></>,
  },
  {
    id: "support",
    title: "7. Help and account communication",
    body: <><p>Signed-in owners can open Settings and select Help. Help provides Docs, an in-app AI guide, and Send a Message for technical issues, billing questions, service problems, cancellation, deletion, or other account requests.</p><p>The AI guide can explain how to use the app and provide page links, but it cannot change account data, billing, leads, conversations, or settings.</p></>,
  },
  {
    id: "responsibilities",
    title: "8. Business responsibilities",
    body: <p>Users are responsible for the accuracy and legality of information they provide, their instructions to the Service, the security of login credentials and downloaded files, and their use of customer or lead information. The business must have any notices, permissions, and consents required to collect, record, contact, message, store, export, or process information through the Service. Users may not share credentials improperly, attempt to access another account, or use the Service for unlawful, fraudulent, abusive, harassing, deceptive, privacy-invasive, or security-invasive activity.</p>,
  },
  {
    id: "ai-output",
    title: "9. Use of information and AI output",
    body: <><p>The Service may organize, summarize, route, or generate information using automated systems. Users remain responsible for reviewing information and deciding how to use it.</p><p>To the maximum extent permitted by law, ARK is not responsible for business decisions, communications, promises, estimates, actions, or other results based on leads, summaries, recordings, AI output, messages, or customer data made available through the Service. The Service is not a substitute for professional advice.</p></>,
  },
  {
    id: "availability",
    title: "10. Availability and changes to the Service",
    body: <p>ARK works to maintain and test the Service but does not promise uninterrupted or error-free operation. Maintenance, updates, third-party outages, internet, phone, messaging-provider, security, or other circumstances outside ARK’s control may affect availability or delivery. ARK may modify features, providers, workflows, pricing for future periods, or technical requirements when reasonably necessary to maintain, secure, improve, or operate the Service, subject to applicable notice requirements.</p>,
  },
  {
    id: "suspension",
    title: "11. Suspension and termination",
    body: <p>ARK may suspend, restrict, or terminate account access for nonpayment, misuse, security risk, legal requirements, material breach of these Terms, or conduct that could harm ARK, its providers, customers, or other people. Where reasonable, ARK will provide notice and an opportunity to correct the issue.</p>,
  },
  {
    id: "liability",
    title: "12. Disclaimer and limitation of liability",
    body: <><p>The Service is provided “as is” and “as available” to the extent permitted by law. ARK disclaims implied warranties that may legally be disclaimed, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p><p>To the maximum extent permitted by law, ARK will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages, or for loss of data, business, goodwill, revenue, or opportunities arising from the Service. ARK’s total liability for a claim will not exceed the amount paid to ARK for the Service during the three months before the event giving rise to the claim. These limits do not apply where applicable law does not allow them.</p></>,
  },
  {
    id: "updates",
    title: "13. Updates and contact",
    body: <><p>ARK may update these Terms as the Service, pricing, providers, or legal requirements change. The version and effective date appear at the top of this page. If a material update requires new consent, ARK may ask users to accept the revised Terms before continuing.</p><p>Owners can use <strong>Settings → Help → Send a Message</strong> for account-specific questions.</p></>,
  },
];

export default function TermsPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12"><div className="mx-auto max-w-4xl"><div className="mb-4"><LegalBackButton /></div><article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><LegalPageHeader title="Terms of Use" effectiveDate={LEGAL_EFFECTIVE_DATE} version={TERMS_VERSION} active="terms" /><div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-24"><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div></article></div></main>;
}
