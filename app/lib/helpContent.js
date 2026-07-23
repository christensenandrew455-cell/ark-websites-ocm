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
    summary: "ARK Client Center gives your business one place to review receptionist activity, manage leads and clients, view the current monthly amount due, update business information, manage payment methods, download data, and request help.",
    points: [
      "The Dashboard is the main page after you sign in or reopen the app.",
      "Settings contains the collapsible AI receptionist and business-information editor, payment controls, data downloads, Help, policies, and documentation.",
      "Help is available only from Settings. It provides Go to Docs, Ask AI, and Send a Message.",
      "The public About, Support, Terms, Privacy, and Docs pages can be reviewed without signing in.",
      "Ask AI can explain the app and provide links. It cannot change billing, account data, leads, clients, or settings.",
    ],
    links: ["Dashboard", "Settings", "Help", "About the App"],
  },
  {
    id: "dashboard-billing",
    title: "This Month amount due",
    summary: "The customer Dashboard shows one current Amount Due figure for this month.",
    points: [
      "The amount starts with the $100 monthly service fee.",
      "Each unique lead added to Contacted Me adds $10 to the current month.",
      "There is no monthly maximum on billable lead charges.",
      "A lead remains billable after it is accepted, moved, contacted, edited, or deleted because the charge occurs when the lead first enters Contacted Me.",
      "Stripe receives the monthly subscription and unique lead usage. Recent usage can take time to appear, and Stripe's finalized invoice controls the final charged amount.",
      "The receptionist-minutes display is an operational usage indicator and is not the formula used by the Dashboard Amount Due card.",
    ],
    links: ["Dashboard", "Payment Terms", "Terms of Use"],
  },
  {
    id: "pricing",
    title: "What the charges pay for",
    summary: "The pricing model is $100 per month plus $10 for every unique lead added to Contacted Me.",
    points: [
      "The service charges support storage and AI usage.",
      "They support maintenance and upkeep as separate operating needs.",
      "They support testing, third-party subscriptions, and labor.",
      "They support the monthly phone-number cost and phone usage.",
      "These descriptions explain what the overall charges support; they are not separate customer rates unless a written agreement or invoice expressly says otherwise.",
    ],
    links: ["Payment Terms", "Terms of Use"],
  },
  {
    id: "contacted-me",
    title: "Contacted Me",
    summary: "Contacted Me shows the people who are currently waiting for your review.",
    points: [
      "A unique lead becomes billable when it is first added to Contacted Me.",
      "View opens the person's saved information.",
      "Delete permanently removes the person from the current Contacted Me list but does not reverse the already-recorded lead charge.",
      "Accept moves the person into Clients.",
      "Accept + Contact moves the person into Clients and opens the available device contact workflow.",
      "The Contacted You statistic preserves historical activity even after a current record is moved or deleted.",
    ],
    links: ["Dashboard"],
  },
  {
    id: "clients",
    title: "Clients",
    summary: "Clients shows the people the business has accepted and currently keeps in its client list.",
    points: [
      "View opens the client's saved information.",
      "Edit updates the saved client details.",
      "Contact opens the device contact workflow when supported.",
      "Confirm Date opens the calendar workflow when supported.",
      "Deleting a client removes the current record but does not reverse the earlier Contacted Me lead charge or historical statistics.",
    ],
    links: ["Dashboard"],
  },
  {
    id: "business-settings",
    title: "Business Information and AI settings",
    summary: "Open Settings and press View and edit on Business Information.",
    points: [
      "The section is collapsed until View and edit is pressed, except during required first-time business setup.",
      "It contains the receptionist voice and timing, business name, receptionist name, owner, phone, email, time zone, business days and hours, estimate availability, service areas, business facts, and services.",
      "The ARK administrator sees the same saved information and also has the private connected phone-number control.",
      "Stripe handles full payment-card details. ARK does not receive or store the full card number.",
    ],
    links: ["Settings", "Privacy Policy"],
  },
  {
    id: "help",
    title: "Help",
    summary: "Help is available only in Settings so the rest of the app stays uncluttered.",
    points: [
      "Go to Docs opens this full app guide.",
      "Ask AI answers questions about using the app and can provide page links.",
      "Send a Message contacts ARK about technical problems, billing questions, service issues, cancellation, deletion, or other account needs.",
      "The AI chat clears 24 hours after the most recent message.",
      "Signed-in Help messages may be unavailable during payment restriction. Public Support remains available for login and general access issues.",
    ],
    links: ["Help", "Send a Message", "Public Support"],
  },
  {
    id: "billing-access",
    title: "Billing, missed payments, and access",
    summary: "Settings opens Stripe's secure billing portal, while the Dashboard shows the current monthly amount due.",
    points: [
      "Use Manage Payment Method in Settings to update the payment method through Stripe.",
      "Stripe processes the $100 monthly subscription and metered $10 lead usage.",
      "After Stripe reports an unpaid scheduled payment, the system normally waits 24 hours before beginning the documented enforcement process.",
      "Payment-restricted mode can allow incoming leads and lead review while disabling Settings, Help messages, downloads, and other features.",
      "When Stripe confirms payment, full access is designed to restore automatically.",
      "Permanent deletion is a separate administrator decision and is not automatic merely because a deadline passes.",
    ],
    links: ["Settings", "Payment Enforcement", "Terms of Use"],
  },
  {
    id: "data-legal",
    title: "Downloads, policies, cancellation, and deletion",
    summary: "Settings includes data download and direct links to Terms, Privacy, Docs, and Help.",
    points: [
      "Download Client Data asks you where to save the JSON file and does not grant the app ongoing access to your files.",
      "Keep downloaded files secure because they can contain customer personal information.",
      "Use Settings, Help, and Send a Message for cancellation or account-deletion requests.",
      "Permanent deletion requires administrator confirmation and removes the active account together with active Contacted Me and Clients records.",
      "The Terms explain pricing, metered leads, payment enforcement, cancellation, exports, and deletion.",
      "The Privacy Policy explains what information ARK and its providers process and why.",
    ],
    links: ["Account Data", "Help", "Terms of Use", "Privacy Policy"],
  },
  {
    id: "where-things-are",
    title: "Where to find everything",
    summary: "Use this quick map when you know what you need but not where it is.",
    points: [
      "Amount Due This Month and stats: Dashboard.",
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
