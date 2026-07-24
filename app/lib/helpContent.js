export const HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Lead Messages", href: "/lead-messages" },
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
    summary: "ARK Client Center receives AI receptionist leads, organizes clients, supports optional lead messaging, tracks usage billing, and provides optional employee routing inside one owner account.",
    points: [
      "The Dashboard is the main page after sign-in.",
      "There is one owner account type and one separate employee account type.",
      "Owner Settings contains receptionist information, feature toggles, payment controls, downloads, Help, and policies.",
      "Employee accounts use a restricted workspace and cannot open owner billing or receptionist settings.",
    ],
    links: ["Dashboard", "Settings", "About the App"],
  },
  {
    id: "pricing",
    title: "The $50 account and usage pricing",
    summary: "Every owner account uses the same simple monthly and usage pricing.",
    points: [
      "The owner account is $50 per monthly billing period.",
      "Each new AI receptionist call or lead delivered to Contacted You is $2.",
      "When Messages is enabled, each new lead conversation is $1.",
      "Additional outbound and inbound texts inside an already-started lead conversation do not create another conversation charge.",
      "When Employees is enabled, each approved active employee account is $5 per billing period.",
      "There are no included units, free allowances, Solo plans, or Business plans.",
    ],
    links: ["Dashboard", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard-billing",
    title: "Dashboard usage and navigation",
    summary: "The top dashboard area shows the estimated total and the usage features enabled for the account.",
    points: [
      "Contacted You is always displayed because calls and new leads are the core receptionist usage.",
      "Messages appears only when the owner turns on Messages in Settings.",
      "Employees appears only when the owner turns on Employees in Settings.",
      "Each usage card shows the current count, unit price, and current-period charge.",
      "Stripe's finalized invoice, credits, taxes, and corrections control the final charged amount.",
    ],
    links: ["Dashboard", "Lead Messages", "Employees"],
  },
  {
    id: "lead-messages",
    title: "Lead Messages",
    summary: "Messages is an optional customer-conversation workspace and is not the ARK support inbox.",
    points: [
      "Turn on Messages from owner Settings to add the Messages tab.",
      "A conversation is counted once when an owner or authorized employee first starts a thread with a lead.",
      "Customer replies appear in the thread, increase the unread count, and can produce a device notification.",
      "Employees can message only assigned leads when the owner also enables Messages for Employees.",
      "The app warns when the outbound messaging provider is not connected; a saved ARK message is not necessarily delivered unless the provider confirms it.",
    ],
    links: ["Lead Messages", "Send a Message", "Payment Terms"],
  },
  {
    id: "employees",
    title: "Employee accounts",
    summary: "The owner can turn on Employees, approve employee accounts, control visible fields, and assign work.",
    points: [
      "An employee chooses Employee Account during signup and enters the business name, employee name, email, phone, and password.",
      "The owner must enable Employees before employee signup is available and must approve each employee before access begins.",
      "Owners use Owner Sign In; employees use Employee Sign In.",
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
      "Choosing Unassigned removes the current employee assignment.",
      "Existing lead conversations follow the current assignment.",
      "Disabling an employee blocks access even if old assignments remain stored for reassignment or audit purposes.",
    ],
    links: ["Employees", "Dashboard"],
  },
  {
    id: "business-names",
    title: "Business names and sign-in",
    summary: "Business names are unique without regard to capitalization.",
    points: [
      "Tabor Painting and tabor painting count as the same business name.",
      "A business-name change is checked against the business registry before it is saved.",
      "The current business name is used for owner and employee sign-in.",
      "Old identifiers may remain reserved for security and account continuity.",
    ],
    links: ["Settings"],
  },
  {
    id: "leads-clients",
    title: "Contacted You and Clients",
    summary: "Contacted You holds new AI receptionist leads, and Clients holds accepted people.",
    points: [
      "A $2 call or lead is counted when the AI receptionist delivers a new unique record into Contacted You.",
      "Accept moves the person into Clients and does not create a second call charge.",
      "Moving, assigning, editing, or deleting a lead does not reverse usage already recorded.",
      "Owners can view all current business records; employees receive only assigned records through their restricted workspace.",
    ],
    links: ["Dashboard", "Employees"],
  },
  {
    id: "settings-help",
    title: "Settings, billing, and Help",
    summary: "Owner controls remain in Settings; employee access questions are handled by the owner.",
    points: [
      "Business Information contains receptionist voice, timing, business details, hours, service areas, facts, and services.",
      "Subscription and Features turns Messages, Employees, and Messages for Employees on or off.",
      "Manage Payment Method opens Stripe's secure billing portal.",
      "Download Client Data is an owner control and is not exposed in the employee workspace.",
      "Delete Account permanently removes the active account and cancels the subscription after typed confirmation.",
      "Go to Docs, Ask AI, and Send a Message are under owner Settings → Help.",
    ],
    links: ["Settings", "Help", "Payment Enforcement", "Privacy Policy"],
  },
  {
    id: "where-things-are",
    title: "Where to find everything",
    summary: "Use this quick map when you know what you need but not where it is.",
    points: [
      "Estimated total and current usage: Dashboard.",
      "Customer lead conversations: Messages, when enabled.",
      "New leads and accepted clients: Dashboard.",
      "Employee approval, visibility, and assignments: Employees, when enabled.",
      "Feature toggles and AI receptionist configuration: Settings.",
      "Payment method, data download, and account deletion: Settings.",
      "ARK support: Settings → Help → Send a Message.",
    ],
    links: ["Dashboard", "Lead Messages", "Employees", "Settings", "Help"],
  },
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
