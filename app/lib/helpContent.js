import { EMPLOYEES_AVAILABLE, MESSAGES_AVAILABLE, UPCOMING_FEATURE_LABEL, UPCOMING_FEATURE_MESSAGE } from "./launchFeatures";

const ALL_HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Messages", href: "/lead-messages" },
  { label: "Employees", href: "/employees" },
  { label: "Settings", href: "/settings" },
  { label: "Help", href: "/help" },
  { label: "Send a Message", href: "/messages" },
  { label: "Account Data", href: "/settings" },
  { label: "Docs", href: "/docs" },
  { label: "About the App", href: "/about" },
  { label: "Public Support", href: "https://arkwebsites.com/support" },
  { label: "Payment Terms", href: "/terms#paid-service" },
  { label: "Employee Terms", href: "/terms#employees" },
  { label: "Payment Enforcement", href: "/terms#payment-enforcement" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_LINKS = ALL_HELP_LINKS.filter((link) => {
  if (!MESSAGES_AVAILABLE && link.label === "Messages") return false;
  if (!EMPLOYEES_AVAILABLE && ["Employees", "Employee Terms"].includes(link.label)) return false;
  return true;
});

const ALL_HELP_SECTIONS = [
  {
    id: "overview",
    title: "What ARK Client Center does",
    summary: MESSAGES_AVAILABLE && EMPLOYEES_AVAILABLE ? "ARK Client Center receives AI receptionist leads, organizes clients, supports optional customer messaging, tracks usage billing, and provides optional employee routing." : `ARK Client Center receives AI receptionist leads, organizes clients, and tracks usage billing. ${UPCOMING_FEATURE_MESSAGE}`,
    points: [
      MESSAGES_AVAILABLE && EMPLOYEES_AVAILABLE ? "The Dashboard is the main page after sign-in and focuses on three statistics: Leads, Messages, and Employees." : "The Dashboard opens Leads now. Messages and Employees appear as disabled upcoming workspaces.",
      "The header shows ARK Client Center, the business name, Settings, and Sign out, without a permanent navigation bar.",
      MESSAGES_AVAILABLE && EMPLOYEES_AVAILABLE ? "Leads, Messages, Employees, and Settings open as focused pages with a Back to Dashboard control." : "Leads and Settings open as focused pages with a Back to Dashboard control.",
      ...(EMPLOYEES_AVAILABLE ? ["There is one owner account type and one separate employee account type.", "Employee accounts use a restricted workspace and cannot open owner billing or receptionist settings."] : []),
    ],
    links: ["Dashboard", "Settings", "About the App"],
  },
  {
    id: "pricing",
    title: "The $50 account and usage pricing",
    summary: "Every owner account uses the same monthly and usage pricing.",
    points: [
      "The owner account is $50 per monthly billing period.",
      "Each new lead is $2 in the period when it arrives. Keeping or deleting the lead later does not count it again or remove the original event.",
      ...(MESSAGES_AVAILABLE ? ["When Messages is enabled, each new chat is $1 once, then combined inbound and outbound SMS usage is $1 whenever the rolling counter completes another 50 parts. Partial progress carries across periods."] : []),
      ...(EMPLOYEES_AVAILABLE ? ["When Employees is enabled, each approved active employee used at any time during the billing period is $5, even if the employee is later disabled or deleted."] : []),
      "Each qualified referral saves 10% for one billing period, up to five referrals and 50% off.",
      "Settings → Payment shows the current counts, subtotal, referral savings, payment method, and estimated total. Stripe's finalized invoice controls the final amount charged.",
    ],
    links: ["Settings", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard",
    title: "Dashboard statistics and shortcuts",
    summary: "The Dashboard shows operational statistics instead of billing details.",
    points: [
      "Leads shows the current combined number of new leads and accepted clients and opens the separate Leads page.",
      MESSAGES_AVAILABLE ? "Messages shows the current conversation count and opens the phone-style inbox when enabled." : `Messages is disabled and marked ${UPCOMING_FEATURE_LABEL.toLowerCase()}.`,
      EMPLOYEES_AVAILABLE ? "Employees shows the current active-employee count and opens employee management when enabled." : `Employees is disabled and marked ${UPCOMING_FEATURE_LABEL.toLowerCase()}.`,
      MESSAGES_AVAILABLE || EMPLOYEES_AVAILABLE ? "When an available optional feature is off, enable it in Settings before using its workspace." : "The upcoming workspace cards cannot be opened during the current launch.",
    ],
    links: ["Dashboard", "Leads", ...(MESSAGES_AVAILABLE ? ["Messages"] : []), ...(EMPLOYEES_AVAILABLE ? ["Employees"] : []), "Settings"],
  },
  {
    id: "lead-messages",
    launchFeature: "messages",
    title: "Customer Messages",
    summary: "Messages works like a normal phone inbox for conversations with leads and clients.",
    points: [
      "The Messages page shows the current number of chats and unread replies.",
      "The page opens to the chat list and does not ask you to choose a lead before showing the inbox.",
      "When there are no conversations, the page says You have no chats and offers Contact Someone.",
      "Contact Someone shows only leads that do not already have a chat, ordered by most recent activity.",
      "Open a lead or client and tap Message to start or continue that person's chat.",
      "Opening a conversation gives the thread most of the screen and provides a back button to return to the chat list.",
      "Each business sends from its own connected Telnyx receptionist number. That number is also used to route customer replies to the correct business.",
      "Employees can message only assigned records when the owner enables Messages for Employees.",
    ],
    links: ["Messages", "Leads", "Dashboard", "Payment Terms"],
  },
  {
    id: "leads-clients",
    title: "Leads, Contacted You, and Clients",
    summary: "The dedicated Leads page contains both new receptionist leads and accepted clients.",
    points: [
      "Tap Leads on the Dashboard to leave the Dashboard and open the separate Leads page.",
      "Contacted You holds new receptionist leads, while Clients holds accepted people.",
      "Accept moves a person from Contacted You into Clients without creating another lead charge.",
      "Lead cards use a smaller action set: Accept where applicable, View, Message when enabled, Edit for clients, and Delete.",
      "Message opens the ARK conversation instead of saving the person to the phone's Contacts app.",
      "Confirm Date remains available from the client detail view and creates a calendar event after a date is entered.",
      "Moving, assigning, editing, or deleting a record does not reverse usage already recorded.",
    ],
    links: ["Leads", ...(MESSAGES_AVAILABLE ? ["Messages"] : []), ...(EMPLOYEES_AVAILABLE ? ["Employees"] : [])],
  },
  {
    id: "employees",
    launchFeature: "employees",
    title: "Employee accounts",
    summary: "The owner can turn on Employees, approve accounts, control visible fields, and assign work.",
    points: [
      "An employee enters the business name, employee name, email, phone, and password during signup.",
      "The owner must enable Employees and approve each employee before access begins.",
      "Employees see only assigned leads, clients, and conversations and only the fields allowed by the owner.",
      "Pending employee accounts do not count. An employee who is active at any time during the billing period is $5 even if disabled or deleted later in that period.",
    ],
    links: ["Employees", "Employee Terms", "Privacy Policy"],
  },
  {
    id: "assignments",
    launchFeature: "employees",
    title: "Assigning work",
    summary: "Owners route each lead or client from the Employees workspace.",
    points: [
      "Open Employees and find Assign Work.",
      "Choose an active employee from the lead or client row.",
      "Choosing Unassigned removes the current assignment.",
      "Existing conversations follow the current assignment.",
      "Disabling an employee blocks access even if an old assignment remains stored for reassignment or audit purposes.",
    ],
    links: ["Employees", "Leads", "Dashboard"],
  },
  {
    id: "settings-help",
    title: "Settings blocks, payment, and Help",
    summary: "Settings opens to four compact blocks and shows only one full section after a block is tapped.",
    points: [
      "Business Information contains business details, services, service areas, optional estimate availability, and optional titled information the AI receptionist can use during calls.",
      MESSAGES_AVAILABLE || EMPLOYEES_AVAILABLE ? "Customization contains Dark Mode, available optional feature controls, AI timing, and Download Client Data." : "Customization contains Dark Mode, AI timing, Download Client Data, and a notice that Messages and Employees are available next month.",
      "Payment contains a live usage breakdown, subtotal, referral savings, estimated total, payment method, Refresh, and Manage Payment Method.",
      "Help & Account contains Help, Documentation, Terms of Use, Privacy Policy, and the typed-confirmation Delete Account control.",
      "Use Back to Settings inside a section to return to the four-block menu.",
      "Use Back to Dashboard at the top of Settings to return to the Dashboard.",
    ],
    links: ["Settings", "Help", "Payment Enforcement", "Privacy Policy"],
  },
  {
    id: "privacy",
    title: "Messaging and privacy",
    summary: "ARK processes the information needed to provide receptionist, lead, employee, and messaging features.",
    points: [
      "Messaging can process business and customer phone numbers, message content, conversation identifiers, delivery status, and provider identifiers.",
      "The business's connected Telnyx number is used to send messages and identify which ARK business should receive an inbound reply.",
      "Owners control employee access and are responsible for appropriate permissions and assignments.",
      "Owners can download current account data from Customization and use Settings or Support for access, correction, or deletion requests.",
    ],
    links: ["Privacy Policy", "Settings", "Public Support"],
  },
];

export const HELP_SECTIONS = [
  ...(!MESSAGES_AVAILABLE || !EMPLOYEES_AVAILABLE ? [{
    id: "upcoming-features",
    title: "Features coming next month",
    summary: "Messages and Employees are not available in the current launch version.",
    points: [
      "Messages, client texting actions, employee signup, employee access, and work assignment are disabled.",
      "The dashboard keeps disabled Messages and Employees cards so their upcoming location is clear.",
      "No messaging or employee usage charges apply while those features are unavailable.",
    ],
    links: ["Dashboard", "About the App"],
  }] : []),
  ...ALL_HELP_SECTIONS.filter((section) => section.launchFeature !== "messages" || MESSAGES_AVAILABLE)
    .filter((section) => section.launchFeature !== "employees" || EMPLOYEES_AVAILABLE),
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
