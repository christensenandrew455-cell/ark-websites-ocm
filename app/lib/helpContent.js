export const HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Messages", href: "/lead-messages" },
  { label: "Employees", href: "/employees" },
  { label: "Settings", href: "/settings" },
  { label: "Help", href: "/help" },
  { label: "Send a Message", href: "/messages" },
  { label: "Account Data", href: "/settings#account-data" },
  { label: "Docs", href: "/docs" },
  { label: "About the App", href: "/about" },
  { label: "Public Support", href: "/support" },
  { label: "Payment Terms", href: "/terms#paid-service" },
  { label: "Employee Terms", href: "/terms#employees" },
  { label: "Payment Enforcement", href: "/terms#payment-enforcement" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_SECTIONS = [
  {
    id: "overview",
    title: "What ARK Client Center does",
    summary: "ARK Client Center receives AI receptionist leads, organizes clients, supports optional customer messaging, tracks usage billing, and provides optional employee routing.",
    points: [
      "The Dashboard is the main page after sign-in and focuses on Leads, Messages, and Employees statistics.",
      "The top header shows ARK Client Center, the business name, Settings, and Sign out. Employee accounts see the business name and Sign out without owner Settings.",
      "There is no permanent workspace navigation bar. Open a dashboard card, then use Back to Dashboard when finished.",
      "There is one owner account type and one separate employee account type.",
      "Employee accounts use a restricted workspace and cannot open owner billing or receptionist settings.",
    ],
    links: ["Dashboard", "Settings", "About the App"],
  },
  {
    id: "pricing",
    title: "The $50 account and usage pricing",
    summary: "Every owner account uses the same monthly and usage pricing.",
    points: [
      "The owner account is $50 per monthly billing period.",
      "Each new AI receptionist call or lead delivered to Contacted You is $2.",
      "When Messages is enabled, each new lead conversation is $1.",
      "Additional outbound and inbound texts inside an already-started conversation do not create another conversation charge.",
      "When Employees is enabled, each approved active employee account is $5 per billing period.",
      "Settings → Subscription and Payment shows one estimated total cost for the current month. Stripe's finalized invoice controls the final amount charged.",
    ],
    links: ["Settings", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard",
    title: "Dashboard statistics and shortcuts",
    summary: "The Dashboard stays focused on current operational statistics instead of billing details or lead lists.",
    points: [
      "Leads shows the current total of new receptionist leads and accepted clients and opens the dedicated Leads page.",
      "Messages shows the current conversation count and opens the phone-style inbox when enabled.",
      "Employees shows the current active employee count and opens employee management when enabled.",
      "Messages and Employees remain visible when turned off. Tapping a disabled card explains that the feature must be enabled in Settings.",
      "Billing totals are not displayed on the Dashboard.",
    ],
    links: ["Dashboard", "Leads", "Messages", "Employees", "Settings"],
  },
  {
    id: "lead-messages",
    title: "Customer Messages",
    summary: "Messages works like a normal phone inbox for conversations with leads and clients.",
    points: [
      "The Messages page shows the current number of chats and unread conversations at the top.",
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
    title: "The Leads page",
    summary: "The dedicated Leads page contains both new receptionist leads and accepted clients.",
    points: [
      "Contacted You shows the current number of new receptionist leads, and Clients shows the current number of accepted people.",
      "Accept moves a person from Contacted You into Clients without creating another lead charge.",
      "Lead cards use a smaller action set: Accept where applicable, View, Message when enabled, Edit for clients, and Delete.",
      "Message opens the ARK conversation instead of saving the person to the phone's Contacts app.",
      "Confirm Date remains available from the client detail view and creates a calendar event after a date is entered.",
      "Moving, assigning, editing, or deleting a record does not reverse usage already recorded.",
    ],
    links: ["Leads", "Messages", "Employees", "Dashboard"],
  },
  {
    id: "employees",
    title: "Employee accounts",
    summary: "The owner can turn on Employees, approve accounts, control visible fields, and assign work.",
    points: [
      "An employee enters the business name, employee name, email, phone, and password during signup.",
      "The owner must enable Employees and approve each employee before access begins.",
      "Employees see only assigned leads, clients, and conversations and only the fields allowed by the owner.",
      "Pending and disabled employee accounts do not count as active employees; each active employee is $5 per billing period.",
    ],
    links: ["Employees", "Employee Terms", "Privacy Policy"],
  },
  {
    id: "assignments",
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
    title: "Settings blocks",
    summary: "Settings opens as four small blocks. Details stay hidden until the owner taps View and edit.",
    points: [
      "Business Information contains business details, hours, services, service areas, and estimate availability.",
      "Customization contains Messages and Employees toggles, Messages for Employees, AI voice and timing, Dark Mode, and Download Client Data.",
      "Dark Mode is saved on the device and changes the app backgrounds and main button colors.",
      "Subscription and Payment shows one estimated total cost for the month and the Manage Payment Method button. It does not show a usage breakdown.",
      "Help and Account contains Help, Docs, Terms, Privacy, and the typed-confirmation Delete Account control.",
      "The old Open Messages and Open Employees buttons are not shown inside Settings.",
    ],
    links: ["Settings", "Help", "Account Data", "Payment Enforcement", "Privacy Policy"],
  },
  {
    id: "privacy",
    title: "Messaging and privacy",
    summary: "ARK processes the information needed to provide receptionist, lead, employee, and messaging features.",
    points: [
      "Messaging can process business and customer phone numbers, message content, conversation identifiers, delivery status, and provider identifiers.",
      "The business's connected Telnyx number is used to send messages and identify which ARK business should receive an inbound reply.",
      "Owners control employee access and are responsible for appropriate permissions and assignments.",
      "Owners can download current account data and use Settings or Support for access, correction, or deletion requests.",
    ],
    links: ["Privacy Policy", "Settings", "Public Support"],
  },
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
