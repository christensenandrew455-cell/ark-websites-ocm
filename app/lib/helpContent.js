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
    summary: "ARK Client Center receives AI receptionist leads, organizes clients, supports lead conversations, tracks billing usage, and offers Business employee routing.",
    points: [
      "The Dashboard is the main page after sign-in.",
      "Solo, Solo Pro, Business owners, and Business employees receive different controls based on their account type.",
      "Owner Settings contains business and receptionist information, payment controls, employee access, downloads, Help, and policies.",
      "Employee accounts use a restricted workspace and cannot open owner billing or receptionist settings.",
    ],
    links: ["Dashboard", "Settings", "About the App"],
  },
  {
    id: "plans",
    title: "Solo, Solo Pro, and Business",
    summary: "Each plan includes a monthly allowance followed by disclosed overage rates.",
    points: [
      "Solo is $100 per billing period, includes 50 leads, and charges $5 per additional lead.",
      "Solo Pro is $200, includes 50 leads and 50 new lead conversations, and charges $5 per additional lead or conversation.",
      "Business is $300, includes 75 leads, 75 new lead conversations, and 3 active employee accounts.",
      "Business charges $5 per additional lead or conversation and $25 per additional active employee.",
      "Messages inside an already-started lead conversation do not create another conversation charge.",
      "Included usage resets or is measured again each billing period and does not roll over.",
    ],
    links: ["Dashboard", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard-billing",
    title: "Dashboard usage and navigation",
    summary: "The top dashboard area shows the estimated total and plan-specific workspace buttons.",
    points: [
      "Solo shows Leads.",
      "Solo Pro shows Messages and Leads.",
      "Business owners show Messages, Leads, and Employees.",
      "The usage cards show included units remaining, units used, and overage cost.",
      "Stripe's finalized invoice, credits, taxes, and corrections control the final charged amount.",
    ],
    links: ["Dashboard", "Lead Messages", "Employees"],
  },
  {
    id: "lead-messages",
    title: "Lead Messages",
    summary: "Messages is a separate lead-conversation workspace and is not the ARK support inbox.",
    points: [
      "A conversation is counted once when an owner or approved employee first starts a thread with a lead.",
      "Additional outbound and inbound texts inside the same thread are included.",
      "Employees can open only conversations connected to leads assigned to them.",
      "The app shows a warning when an outbound messaging provider is not connected; a saved ARK message should not be treated as delivered unless delivery is confirmed.",
      "Use Settings → Help → Send a Message to contact ARK support instead of a customer lead.",
    ],
    links: ["Lead Messages", "Send a Message", "Payment Terms"],
  },
  {
    id: "business-employees",
    title: "Business employee accounts",
    summary: "Business owners approve employees, control visible fields, and assign work.",
    points: [
      "An employee chooses Business during signup, then Employee account, and enters the business name, employee name, email, phone, and password.",
      "The owner must approve the employee before the employee can see assigned work.",
      "Business sign-in uses the business name, the owner's or employee's name, and the person's password.",
      "Employees see only assigned leads, clients, and conversations.",
      "The owner can allow or hide lead name, phone, email, address, requested work, requested date or time, and notes.",
      "Pending and disabled employee accounts are not intended to count as active seats.",
    ],
    links: ["Employees", "Employee Terms", "Privacy Policy"],
  },
  {
    id: "assignments",
    title: "Assigning work",
    summary: "Business owners route each lead or client from the Employees workspace.",
    points: [
      "Open Employees and find Assign Work.",
      "Choose an active employee from the lead or client row.",
      "Choosing Unassigned removes the current employee assignment.",
      "Existing lead conversations follow the current assignment so the newly assigned employee can access the thread.",
      "Disabling an employee blocks that employee's API access even if old assignments remain stored for audit or reassignment.",
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
      "The new business name becomes available for sign-in after saving.",
      "Old identifiers may remain reserved for security and account continuity.",
    ],
    links: ["Settings"],
  },
  {
    id: "leads-clients",
    title: "Contacted Me and Clients",
    summary: "Contacted Me holds new leads, and Clients holds accepted people.",
    points: [
      "A lead is counted when the AI receptionist delivers a new unique record into Contacted Me.",
      "Accept moves the person into Clients and does not create a second lead charge.",
      "Moving, assigning, editing, or deleting a lead does not reverse usage already recorded.",
      "Owners can view and manage all current business records; employees receive only assigned records through their restricted workspace.",
    ],
    links: ["Dashboard", "Employees"],
  },
  {
    id: "settings-help",
    title: "Settings, billing, and Help",
    summary: "Owner controls remain in Settings; employee access questions are handled by the business owner.",
    points: [
      "Business Information contains receptionist voice, timing, business details, hours, service areas, facts, and services.",
      "Business owners can open Employees and Access from Settings.",
      "Manage Payment Method opens Stripe's secure billing portal.",
      "Download Client Data is an owner control and is not exposed in the employee workspace.",
      "Go to Docs, Ask AI, and Send a Message are under owner Settings → Help.",
    ],
    links: ["Settings", "Help", "Payment Enforcement", "Privacy Policy"],
  },
  {
    id: "where-things-are",
    title: "Where to find everything",
    summary: "Use this quick map when you know what you need but not where it is.",
    points: [
      "Estimated total and plan usage: Dashboard.",
      "Customer lead conversations: Messages.",
      "New leads and accepted clients: Dashboard.",
      "Employee approval, visibility, and assignments: Employees.",
      "Business and AI receptionist configuration: Settings → Business Information.",
      "Payment method and owner data download: Settings.",
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
