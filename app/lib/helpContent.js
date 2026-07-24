export const HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Settings", href: "/settings" },
  { label: "Help", href: "/help" },
  { label: "Send a Message", href: "/messages" },
  { label: "Account Data", href: "/settings#account-data" },
  { label: "Docs", href: "/docs" },
  { label: "About the App", href: "/about" },
  { label: "Public Support", href: "/support" },
  { label: "Payment Terms", href: "/terms#paid-service" },
  { label: "Payment Enforcement", href: "/terms#payment-enforcement" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_SECTIONS = [
  {
    id: "overview",
    title: "What ARK Client Center does",
    summary: "ARK Client Center gives a business one place to review AI receptionist leads, organize clients, view billing usage, manage account information, and request help.",
    points: [
      "The Dashboard is the main page after sign-in.",
      "The Dashboard shows the estimated monthly total, included usage remaining, and overage usage.",
      "Settings contains business and receptionist information, payment controls, data downloads, Help, policies, and documentation.",
      "The public About, Support, Terms, Privacy, and Docs pages can be reviewed without signing in.",
    ],
    links: ["Dashboard", "Settings", "About the App"],
  },
  {
    id: "solo-plans",
    title: "Solo plans",
    summary: "ARK OCM currently offers Solo and Solo Pro. Business plans are not currently offered inside the app.",
    points: [
      "Solo is $100 per monthly billing period and includes 50 AI receptionist leads.",
      "After the 50 included Solo leads, each additional lead is $5.",
      "Solo Pro is $200 per monthly billing period and includes 50 AI receptionist leads plus 50 new lead conversations.",
      "After the included Solo Pro usage, each additional lead is $5 and each additional new lead conversation is $5.",
      "Extra messages inside the same already-started conversation do not create another conversation charge.",
      "Included usage resets each billing period and does not roll over.",
    ],
    links: ["Dashboard", "Payment Terms", "Terms of Use"],
  },
  {
    id: "dashboard-billing",
    title: "Monthly billing dashboard",
    summary: "The top dashboard card shows the current plan and estimated total for the active monthly billing period.",
    points: [
      "The total starts with the selected plan's monthly fee.",
      "The Leads card shows leads used, free leads remaining, and lead overage.",
      "Solo Pro also shows new lead conversations used, free conversations remaining, and conversation overage.",
      "The displayed overage total is added to the plan fee.",
      "Recent usage can take time to process, and Stripe's finalized invoice controls the final charged amount.",
    ],
    links: ["Dashboard", "Payment Terms"],
  },
  {
    id: "lead-definition",
    title: "What counts as a lead",
    summary: "A lead is counted when the AI receptionist delivers a new, unique lead into Contacted Me.",
    points: [
      "The first 50 leads in each billing period are included on both Solo plans.",
      "A counted lead stays counted after it is accepted, moved, contacted, edited, or deleted.",
      "Moving a lead into Clients does not create a second lead charge.",
      "A verified duplicate created only by a system error can be reviewed by ARK support.",
    ],
    links: ["Dashboard", "Send a Message"],
  },
  {
    id: "conversation-definition",
    title: "What counts as a Solo Pro conversation",
    summary: "A conversation is counted once when a distinct conversation thread is first started with a lead.",
    points: [
      "Solo Pro includes 50 new lead conversations per billing period.",
      "Sending another text inside the same conversation does not create another charge.",
      "Starting a separate conversation with another lead counts as another conversation.",
      "Conversation billing is available only on Solo Pro.",
    ],
    links: ["Dashboard", "Payment Terms"],
  },
  {
    id: "contacted-me",
    title: "Contacted Me",
    summary: "Contacted Me shows people currently waiting for review.",
    points: [
      "View opens the saved lead information.",
      "Accept moves the person into Clients.",
      "Accept + Contact moves the person into Clients and opens the available device contact workflow.",
      "Deleting or moving a lead does not reverse usage already recorded for billing or historical statistics.",
    ],
    links: ["Dashboard"],
  },
  {
    id: "clients",
    title: "Clients",
    summary: "Clients shows people the business has accepted and currently keeps in its client list.",
    points: [
      "View opens saved client information.",
      "Edit updates the saved client details.",
      "Contact opens the supported device contact workflow.",
      "Confirm Date opens the supported calendar workflow.",
    ],
    links: ["Dashboard"],
  },
  {
    id: "business-settings",
    title: "Business Information and AI settings",
    summary: "Open Settings and press View and edit on Business Information.",
    points: [
      "The section contains receptionist voice and timing, business name, receptionist name, owner, phone, email, time zone, hours, service areas, business facts, and services.",
      "The ARK administrator sees the same saved information and also has private connection controls.",
      "Stripe handles full payment-card details. ARK does not receive or store the full card number.",
    ],
    links: ["Settings", "Privacy Policy"],
  },
  {
    id: "help",
    title: "Help",
    summary: "Help is available from Settings.",
    points: [
      "Go to Docs opens the full app guide.",
      "Ask AI answers questions about using the app and can provide page links.",
      "Send a Message contacts ARK about technical problems, billing questions, service issues, cancellation, deletion, or other account needs.",
      "The AI guide cannot change billing, account data, leads, clients, conversations, or settings.",
    ],
    links: ["Help", "Send a Message", "Public Support"],
  },
  {
    id: "billing-access",
    title: "Payment method and missed payments",
    summary: "Settings opens Stripe's secure billing portal, while the Dashboard shows current usage and the estimated monthly total.",
    points: [
      "Use Manage Payment Method in Settings to update the payment method through Stripe.",
      "After Stripe reports an unpaid scheduled payment, the documented payment-enforcement process can begin.",
      "Payment-restricted mode can allow incoming leads and lead review while disabling Settings, Help messages, lead messaging, downloads, and other features.",
      "When Stripe confirms payment, full access is designed to restore automatically.",
      "Permanent deletion is a separate administrator decision and is not automatic merely because a deadline passes.",
    ],
    links: ["Settings", "Payment Enforcement", "Terms of Use"],
  },
  {
    id: "where-things-are",
    title: "Where to find everything",
    summary: "Use this quick map when you know what you need but not where it is.",
    points: [
      "Monthly total, included usage, overages, and stats: Dashboard.",
      "Contacted Me and Clients: Dashboard below the stats area.",
      "Business Information and AI settings: Settings, then View and edit.",
      "Payment method: Settings, then Payment Method.",
      "Download Client Data: Settings.",
      "Docs, Ask AI, and Send a Message: Settings, then Help.",
      "Terms, Privacy, and Docs links: Settings.",
    ],
    links: ["Dashboard", "Settings", "Help", "Terms of Use", "Privacy Policy"],
  },
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
