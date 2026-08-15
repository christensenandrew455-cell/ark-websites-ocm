import LegalPageHeader from "../components/LegalPageHeader";
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
      <p>During signup, Stripe securely collects and saves a payment method inside the Service. Completing that setup screen does not itself charge the payment method. The owner authorizes Stripe to use the saved payment method for later recurring account fees, measured usage, applicable taxes, and other charges separately agreed in writing.</p>
      <p><strong>Monthly account:</strong> $50 USD per monthly billing period for one business account and its AI receptionist workspace.</p>
      <p><strong>Leads:</strong> $2 USD for each new lead received during the billing period. A lead is charged in the period when it arrives. Keeping it into a later period does not charge it again, and deleting it does not reverse the original charge.</p>
      <p><strong>Messages:</strong> When Messages is enabled, $1 USD is charged once when each new chat is created. Inbound and outbound SMS parts are then combined on one rolling counter, and $1 USD is charged each time the counter completes another 50 parts. Partial progress carries across billing periods, and long messages may use more than one SMS part.</p>
      <p><strong>Recorded usage:</strong> Deleting a chat, message, lead, or client record does not remove valid new-lead, chat-creation, or completed SMS-part usage already incurred.</p>
      <p><strong>What counts as a lead:</strong> Each newly received estimate request or other connected intake submission creates one durable lead event. Moving, editing, retaining, or deleting that lead does not create another charge or erase the original event. Duplicate events caused solely by a verified system error may be corrected by ARK.</p>
      <p><strong>Referrals:</strong> When a new paid account enters an eligible referring account ID and activates, the referring account receives 10% off one billing period. An account may qualify for no more than five referrals, or 50% off, in one billing period. Referral discounts do not carry forward, cannot reduce an invoice below zero, and may be withheld or reversed for duplicate, self, invalid, fraudulent, canceled, refunded, or otherwise ineligible accounts.</p>
      <p><strong>Dashboard estimate:</strong> The dashboard may show the account fee, current counts, unit prices, subtotal, referral savings, and estimated total. Usage can take time to process. Stripe’s finalized invoice, credits, taxes, corrections, disputes, and payment records control the final amount charged.</p>
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
    body: <><p><strong>Initial 24-hour period:</strong> When Stripe reports that a scheduled payment was not completed, ARK normally allows a 24-hour period for the payment to clear or the payment method to be corrected before beginning enforcement.</p><p><strong>Rolling six-month incident record:</strong> Late-payment incidents are counted within a rolling six-month period. A completed payment resolves the current incident and restores available access, but the incident may remain in the rolling count for six months.</p><p><strong>First incident:</strong> After the initial period, ARK normally provides seven days to complete payment before placing the account in payment-restricted mode. If payment remains unpaid for seven additional days while restricted, the account may be placed into manual deletion review.</p><p><strong>Second incident:</strong> After the initial period, ARK may place the account directly into payment-restricted mode. If payment remains unpaid for seven days while restricted, the account may be placed into manual deletion review.</p><p><strong>Third or later incident:</strong> ARK may place the account into payment-restricted mode and manual deletion review without another grace period.</p><p><strong>Payment-restricted mode:</strong> The business may continue receiving new leads and may review and accept those leads into Clients. Other features may be unavailable, including settings changes, Help messages, messaging, and client-data downloads.</p><p><strong>Restoration:</strong> When Stripe confirms payment, the warning and restriction are designed to clear automatically. Processing delays, disputes, reversals, or provider outages may delay restoration.</p></>,
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
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12"><article className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><LegalPageHeader title="Terms of Use" effectiveDate={LEGAL_EFFECTIVE_DATE} version={TERMS_VERSION} active="terms" /><div className="mt-7 space-y-8 text-sm leading-7 text-slate-700 sm:text-base">{sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-24"><h2 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{section.title}</h2><div className="mt-2 space-y-3">{section.body}</div></section>)}</div></article></main>;
}
