import { MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL, UPCOMING_FEATURE_MESSAGE } from "./launchFeatures";

const ALL_HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Messages", href: "/lead-messages" },
  { label: "Settings", href: "/settings" },
  { label: "Help", href: "/help" },
  { label: "Send a Message", href: "/messages" },
  { label: "Account Data", href: "/settings" },
  { label: "Docs", href: "/docs" },
  { label: "About the App", href: "/about" },
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
    summary: `ARK Client Center receives AI receptionist leads, organizes clients, and tracks usage billing. ${!MESSAGES_AVAILABLE ? UPCOMING_FEATURE_MESSAGE : "Optional customer messaging is available from the same account."}`,
    points: [
      "The Dashboard is the main page after sign-in and provides shortcuts to leads, available messaging, and Settings.",
      "The header shows ARK Client Center, the business name, Settings, and Sign out without a permanent navigation bar.",
      "Leads, available Messages, and Settings open as focused pages with a Back to Dashboard control.",
      "Each business has one owner account for receptionist details, feature controls, billing, policies, downloads, and account deletion.",
    ],
    links: ["Dashboard", "Settings", "About the App"],
  },
  {
    id: "account-setup",
    title: "Creating an account",
    summary: "Account setup verifies the owner's contact information before business information and payment, then creates the regular account after Stripe succeeds.",
    points: [
      "Step 1 collects the main account information and password.",
      "Step 2 verifies both the email address and phone number with separate four-digit codes.",
      "Step 3 collects the business and AI receptionist information.",
      "Step 4 shows Stripe's secure Payment Element, saves the payment method, and starts the $50 monthly subscription.",
      "After payment details succeed, ARK moves the temporary signup into a regular account.",
    ],
    links: ["About the App", "Payment Terms", "Privacy Policy"],
  },
  {
    id: "pricing",
    title: "The $50 account and usage pricing",
    summary: "Every account uses the same monthly and usage pricing.",
    points: [
      "The business account is $50 per monthly billing period.",
      "Each completed receptionist call or other new lead is $2. A lead saved from the same receptionist call counts once, not twice. Keeping or deleting it later does not count it again or remove the original event.",
      ...(MESSAGES_AVAILABLE ? ["When Messages is enabled, each new chat adds $1 and the combined inbound and outbound SMS counter adds $1 whenever it completes another 50 parts. Partial progress carries forward."] : []),
      "Usage is charged in exact $20 intervals. If a two-point lead takes the balance from 19 to 21, ARK charges $20 and starts the next interval at 1.",
      "Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.",
      "Settings → Payment shows the rolling usage balance out of $20, SMS-part progress, the payment method, and the last successful payment.",
    ],
    links: ["Settings", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard",
    title: "Dashboard statistics and shortcuts",
    summary: "The Dashboard shows operational statistics instead of billing details.",
    points: [
      "Leads shows the current combined number of new leads and accepted clients and opens the dedicated Leads page.",
      MESSAGES_AVAILABLE ? "Messages shows the current conversation count and opens the phone-style inbox when enabled." : `Messages is disabled and marked ${UPCOMING_FEATURE_LABEL.toLowerCase()}.`,
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
      "Contacted You holds new receptionist leads, while Clients holds accepted people.",
      "Accept moves a person from Contacted You into Clients without creating another lead charge.",
      "Lead cards provide Accept where applicable, View, Message when available, Edit for clients, and Delete.",
      "Confirm Date remains available from the client detail view and creates a calendar event after a date is entered.",
      "Moving, editing, or deleting a record does not reverse usage already recorded.",
    ],
    links: ["Leads", ...(MESSAGES_AVAILABLE ? ["Messages"] : [])],
  },
  {
    id: "settings-help",
    title: "Settings, payment, and Help",
    summary: "Settings groups business information, customization, payment, and account support.",
    points: [
      "Business Information contains business details, services, service areas, optional estimate availability, and information the AI receptionist can use during calls.",
      MESSAGES_AVAILABLE ? "Customization contains Dark Mode, the Messages control, AI timing, retention settings, and Download Client Data." : `Customization contains Dark Mode, AI timing, retention settings, Download Client Data, and a notice that ${UPCOMING_FEATURE_MESSAGE.toLowerCase()}`,
      "Payment contains the $50 monthly rate, a usage bar out of $20, the saved payment method, Refresh, and Manage Payment Method.",
      "Help & Account contains Help, Documentation, Terms of Use, Privacy Policy, and the typed-confirmation Delete Account control.",
    ],
    links: ["Settings", "Help", "Payment Enforcement", "Privacy Policy"],
  },
  {
    id: "privacy",
    title: "Messaging and privacy",
    summary: "ARK processes the information needed to provide receptionist, lead, account, billing, and available messaging features.",
    points: [
      "Stripe controls the sensitive fields in the in-app Payment Element; ARK stores only Stripe identifiers and a non-sensitive payment-method label.",
      "Messaging can process business and customer phone numbers, message content, conversation identifiers, delivery status, and provider identifiers.",
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
