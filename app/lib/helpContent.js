import { MESSAGES_AVAILABLE } from "./launchFeatures.js";
import { activeWebLaunchOffer, discountedAmountCents, TEMPORARY_FEATURES } from "./temporaryFeatures.js";

const websiteOffer = activeWebLaunchOffer();

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

const ALL_HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Messages", href: "/lead-messages" },
  { label: "Settings", href: "/settings" },
  { label: "Help & Account", href: "/settings?section=account" },
  { label: "AI Chat", href: "/settings?section=account&chat=open" },
  { label: "Support", href: "/messages" },
  ...(TEMPORARY_FEATURES.feedback.enabled ? [{ label: "Give Feedback", href: "/feedback" }] : []),
  { label: "Account Data", href: "/settings" },
  { label: "Docs", href: "/docs" },
  { label: "Public Support", href: "https://arkwebsites.com/support" },
  { label: "Payment Terms", href: "/terms#paid-service" },
  { label: "Payment Enforcement", href: "/terms#payment-enforcement" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_LINKS = ALL_HELP_LINKS.filter((link) => MESSAGES_AVAILABLE || link.label !== "Messages");

const sections = [
  {
    id: "overview",
    title: "What ARK Client Center does",
    summary: MESSAGES_AVAILABLE
      ? "ARK Client Center receives AI receptionist leads, organizes clients, tracks monthly accepted leads, and provides optional customer messaging."
      : "ARK Client Center receives AI receptionist leads, organizes clients, and tracks monthly accepted leads.",
    points: [
      MESSAGES_AVAILABLE
        ? "The Dashboard is the main page after sign-in and provides shortcuts to leads, messaging, and Settings."
        : "The Dashboard is the main page after sign-in and provides shortcuts to Leads and Settings.",
      "The header shows ARK Client Center, the business name, Settings, and Sign out without a permanent navigation bar.",
      MESSAGES_AVAILABLE
        ? "Leads, Messages, and Settings open as focused pages with a Back to Dashboard control."
        : "Leads and Settings open as focused pages with a Back to Dashboard control.",
      "Each business has one owner account for receptionist details, feature controls, billing, policies, downloads, and account deletion.",
    ],
    links: ["Dashboard", "Settings", "Help & Account"],
  },
  {
    id: "account-setup",
    title: "Creating an account",
    summary: "Account setup verifies the owner's contact information before business information and payment, then creates the regular account after Apple or Stripe succeeds.",
    points: [
      "Step 1 collects the main account information and password.",
      "Step 2 verifies both the email address and phone number with separate four-digit codes.",
      "Step 3 collects the business and AI receptionist information.",
      "Step 4 lets the owner choose Starter, Standard, Growth, or Pro, then uses Apple In-App Purchase on iPhone or Stripe's secure Payment Element elsewhere.",
      "After payment details succeed, ARK moves the temporary signup into a regular account.",
    ],
    links: ["Payment Terms", "Privacy Policy"],
  },
  {
    id: "pricing",
    title: "Monthly accepted-lead plans",
    summary: "Choose a monthly plan based on how many leads the business expects to accept.",
    points: [
      "Starter is $49.99 per month for 50 accepted leads.",
      "Standard is $79.99 per month for 100 accepted leads.",
      "Growth is $149.99 per month for 250 accepted leads.",
      "Pro is $299.99 per month for 500 accepted leads.",
      ...(websiteOffer ? [`For a limited launch period, new website signups receive ${websiteOffer.percentOff}% off every plan while their subscription remains active: ${money(discountedAmountCents(4999, websiteOffer))} Starter, ${money(discountedAmountCents(7999, websiteOffer))} Standard, ${money(discountedAmountCents(14999, websiteOffer))} Growth, or ${money(discountedAmountCents(29999, websiteOffer))} Pro per month. Native app purchases keep their regular store price.`] : []),
      "Only tapping Accept uses the plan. Calls, declines, edits, and deletions do not count.",
      "Settings → Payment shows the current plan, accepted leads used, accepted leads remaining, reset date, and payment method.",
    ],
    links: ["Settings", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard",
    title: "Dashboard statistics and shortcuts",
    summary: "The Dashboard shows operational statistics instead of billing details.",
    points: [
      "Accepted Leads shows the current number of accepted clients and opens the Clients list; its subtitle shows how many new leads are waiting.",
      ...(MESSAGES_AVAILABLE ? ["Messages shows the current conversation count and opens the phone-style inbox when enabled."] : []),
      ...(MESSAGES_AVAILABLE ? ["If Messages is off for the account, enable it in Settings before using that workspace."] : []),
    ],
    links: ["Dashboard", "Leads", ...(MESSAGES_AVAILABLE ? ["Messages"] : []), "Settings"],
  },
  ...(MESSAGES_AVAILABLE ? [{
    id: "lead-messages",
    title: "Customer Messages",
    summary: "Messages works like a normal phone inbox for conversations with leads and clients.",
    points: [
      "The Messages page shows the current number of chats and unread replies.",
      "When there are no conversations, Contact Someone shows leads that do not already have a chat.",
      "Open a lead or client and tap Message to start or continue that person's chat.",
      "Each business sends from its connected Telnyx receptionist number, which also routes replies to the correct account.",
    ],
    links: ["Messages", "Leads", "Dashboard", "Payment Terms"],
  }] : []),
  {
    id: "leads-clients",
    title: "Leads, Contacted You, and Clients",
    summary: "The dedicated Leads page contains both new receptionist leads and accepted clients.",
    points: [
      "Contacted You shows only the caller's name, requested service, and risk level until the lead is accepted.",
      "Accept moves a person into Clients. Decline removes the lead.",
      "Risk levels are Low (0–2), Moderate (3–5), High (6–8), and Very high (9+).",
      MESSAGES_AVAILABLE
        ? "Lead cards provide Accept or Decline, while accepted Clients provide full details, Message, Edit, and Delete."
        : "Lead cards provide Accept or Decline, while accepted Clients provide full details, Edit, and Delete.",
      "Confirm Date remains available from the client detail view and creates a calendar event after a date is entered.",
      "Editing or deleting an accepted client does not undo that month's accepted-lead count.",
    ],
    links: ["Leads", ...(MESSAGES_AVAILABLE ? ["Messages"] : [])],
  },
  {
    id: "settings-help",
    title: "Settings, payment, and support",
    summary: "Settings groups business information, customization, payment, and account support.",
    points: [
      "Business Information contains business details, services, service areas, optional estimate availability, and information the AI receptionist can use during calls.",
      MESSAGES_AVAILABLE
        ? "Customization contains Dark Mode, the Messages control, AI timing, retention settings, and Download Client Data."
        : "Customization contains Dark Mode, AI timing, retention settings, and Download Client Data.",
      "Payment contains the current monthly plan, a remaining-calls bar, all plan options, the payment provider, Refresh, and the matching Apple or Stripe billing control.",
      `Help & Account contains Docs, AI Chat, Support,${TEMPORARY_FEATURES.feedback.enabled ? " Give Feedback," : ""} Terms of Use, Privacy Policy, and the typed-confirmation Delete Account control.`,
    ],
    links: ["Help & Account", "AI Chat", "Support", ...(TEMPORARY_FEATURES.feedback.enabled ? ["Give Feedback"] : []), "Payment Enforcement", "Privacy Policy"],
  },
  {
    id: "privacy",
    title: MESSAGES_AVAILABLE ? "Messaging and privacy" : "Privacy and account data",
    summary: MESSAGES_AVAILABLE
      ? "ARK processes the information needed to provide receptionist, lead, account, billing, and messaging features."
      : "ARK processes the information needed to provide receptionist, lead, account, and billing features.",
    points: [
      "Apple or Stripe controls sensitive payment details; ARK stores only the provider identifiers and billing state needed to verify purchases and operate the account.",
      ...(MESSAGES_AVAILABLE ? ["Messaging can process business and customer phone numbers, message content, conversation identifiers, delivery status, and provider identifiers."] : []),
      "Owners can download current account data from Customization and use Settings or Support for access, correction, or deletion requests.",
    ],
    links: ["Privacy Policy", "Settings", "Public Support"],
  },
];

export const HELP_SECTIONS = sections;

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
