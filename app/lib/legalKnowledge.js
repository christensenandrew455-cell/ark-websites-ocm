import { MESSAGES_AVAILABLE } from "./launchFeatures.js";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_VERSION,
  TERMS_EFFECTIVE_DATE,
  TERMS_VERSION,
} from "./legal.js";

export const TERMS_KNOWLEDGE_SECTIONS = [
  ["Agreement", "The Terms govern ARK Client Center, the AI receptionist, lead management, support, billing, and related services. The account owner must be an adult with authority to agree for the business."],
  ["Accepted-lead plans", "Starter is $24.99 per month for 25 accepted leads; Standard is $47.49 for 50; Growth is $89.99 for 100; Scale is $169.99 for 200. A unique request counts once when the owner accepts it. Calls, declines, repeated acceptance attempts, edits, retention, and deletion do not count. Included unused leads do not roll over."],
  ["Extra and free leads", "Extra accepted leads cost $1 each for the current billing period, have no volume discount, expire at reset, and do not roll over. Eligible free lead credits stay banked, have no cash value, and can be applied in groups of five only after the included allowance is exhausted."],
  ["Plan changes", "Stripe owners may schedule a plan for renewal with no charge today or switch now by paying the new plan price. An immediate switch starts a new billing period and does not refund, credit, or carry over unused leads. Apple controls App Store plan-change timing and proration."],
  ["Refunds", "A directly purchased first Stripe subscription charge may be requested for refund within seven calendar days. The window excludes renewals, top-ups, Apple purchases, custom work, provider charges, taxes, previously refunded accounts, fraud, or abuse, subject to applicable law. Apple controls App Store refunds."],
  ["Payment failure", "A failed recurring payment pauses the receptionist and new lead intake while billing access remains. Stripe accounts have the displayed seven-day recovery window and may be permanently deleted if payment is not restored. Apple accounts follow Apple billing retry and are not deleted only because seven days passed."],
  ["Cancellation and deletion", `An owner can use typed confirmation to delete the active account and supported lead and client data${MESSAGES_AVAILABLE ? ", including supported conversation data" : ""}. Download needed data first. An Apple subscription must be canceled with Apple; deleting the ARK account does not cancel Apple billing.`],
  ["Business responsibilities", "The business is responsible for accurate information, lawful instructions, login and file security, reviewing AI output, business decisions, and any required notices or consent for calls, recordings, customer data, texts, storage, or follow-up."],
  ["AI and appointments", "Automated systems may route, summarize, classify, or respond to information. The business must review the result. A requested day or time window is not a confirmed appointment, and ARK does not guarantee availability or a business outcome."],
  ["Availability and conduct", "ARK may change or suspend service when needed for maintenance, security, nonpayment, misuse, legal requirements, or provider limitations. Users may not access other accounts, evade restrictions, interfere with the service, or use it for unlawful, deceptive, abusive, or privacy-invasive activity."],
  ["Support", "Signed-in owners can use Settings → Help & Account → Support. AI Chat can explain the app and policies but cannot change accounts, billing, leads, or settings."],
];

export const PRIVACY_KNOWLEDGE_SECTIONS = [
  ["Scope", `The Privacy Policy covers ARK Client Center, the website, AI receptionist, lead management${MESSAGES_AVAILABLE ? ", optional customer messaging" : ""}, notifications, support, billing, and related services.`],
  ["Information collected", "ARK processes account and business details; customer and lead contact and request details; billing-provider identifiers and plan usage; reward and referral records; receptionist, call, app, device, notification, support, feedback, security, and legal-acceptance records."],
  ["Sensitive payment data", "Apple or Stripe controls sensitive payment details. ARK does not receive or store full card numbers, card security codes, card expiration values, or Apple Account credentials."],
  ["How information is used", "ARK uses information to create and verify accounts, operate the receptionist, organize leads and clients, deliver alerts, count accepted leads, process billing and rewards, provide help and downloads, prevent abuse, secure and improve the service, enforce policies, and meet legal duties."],
  ["AI processing", "Customer and lead information may be processed by automated or AI systems to route, summarize, classify, or respond according to the account configuration and supplied business facts."],
  ["Providers and disclosure", "ARK may give service providers only the information reasonably needed for hosting, databases, phone and AI service, payment, authentication, email, text delivery, notifications, security, support, and app distribution. ARK may disclose information when law or safety requires it."],
  ["Sale and advertising", "ARK does not sell customer, lead, caller, owner, or account information for money and does not use it for unrelated third-party advertising."],
  ["Retention", `Active account and customer data is generally kept while needed for service. Owners may choose available auto-delete periods for leads, clients${MESSAGES_AVAILABLE ? ", and conversations" : ""}. AI-help chat clears 24 hours after the last message.`],
  ["Export and deletion", "Owners can download supported current account data while the account has access. Typed-confirmation deletion removes active account and supported lead and client data. Limited billing, transaction, call-total, security, fraud-prevention, agreement, audit, backup, deletion, or legal records may remain where allowed or required."],
  ["Administrator access", "Authorized ARK administrators may access account, business, customer, lead, billing, support, notification, and technical records when needed to operate, secure, troubleshoot, support, bill, enforce, or improve the service. Administrators do not receive passwords or full card details."],
  ["Choices and requests", "Owners can change alerts and retention, download supported data, manage payment, or delete the account in Settings. ARK may verify identity and account authority before fulfilling access, correction, privacy, billing, or deletion requests."],
  ["Security and responsibilities", "ARK uses administrative, technical, and organizational safeguards, but no internet, phone, cloud, or storage system is absolutely secure. Businesses must protect credentials and downloaded files and obtain required customer notices and consent."],
];

function renderPolicy(title, version, effectiveDate, sections) {
  return [
    `# ${title}`,
    `Version: ${version}`,
    `Effective date: ${effectiveDate}`,
    ...sections.map(([heading, content]) => `## ${heading}\n${content}`),
  ].join("\n\n");
}

export const TERMS_KNOWLEDGE = renderPolicy("Terms of Use", TERMS_VERSION, TERMS_EFFECTIVE_DATE, TERMS_KNOWLEDGE_SECTIONS);
export const PRIVACY_KNOWLEDGE = renderPolicy("Privacy Policy", PRIVACY_VERSION, PRIVACY_EFFECTIVE_DATE, PRIVACY_KNOWLEDGE_SECTIONS);
export const LEGAL_KNOWLEDGE = `${TERMS_KNOWLEDGE}\n\n${PRIVACY_KNOWLEDGE}`;
