export const HELP_LINKS = [
  { label: "Clients", href: "/" },
  { label: "Settings", href: "/settings" },
  { label: "Requests", href: "/messages" },
  { label: "Docs", href: "/docs" },
  { label: "Payment Terms", href: "/terms#payment-enforcement" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_SECTIONS = [
  {
    id: "overview",
    title: "What ARK Client Center does",
    summary: "ARK Client Center gives your business one place to review activity, manage leads and clients, update account information, manage payment methods, request changes, get urgent help, and review account policies.",
    points: [
      "The Clients page is the main page after you sign in.",
      "Settings contains your business details, billing controls, requests, policies, and documentation.",
      "The Help button is available throughout the full-access signed-in app. It can open these docs or start a quick AI help chat.",
      "The AI help chat can explain the app and send you to the correct page. It cannot change your account, billing, clients, or requests for you.",
    ],
    links: ["Clients", "Settings"],
  },
  {
    id: "stats",
    title: "Your Stats",
    summary: "Your Stats is at the top of the Clients page. Use Today, This Month, or All Time to change the reporting period.",
    points: [
      "Contacted You is a permanent activity total. Moving or deleting a person later does not remove the earlier contact from this statistic.",
      "Usage shows recorded usage above the amount included with your plan. Applicable overage charges can be added to your next payment.",
      "Clients is a permanent total of people accepted as clients. Deleting a client later does not reduce the historical total.",
      "The numbers in Your Stats are historical records. The live Contacted Me and Clients lists below them show only the records currently in those lists.",
    ],
    links: ["Clients"],
  },
  {
    id: "contacted-me",
    title: "Contacted Me",
    summary: "Contacted Me shows the people who are currently waiting for your review, with the oldest waiting lead shown first.",
    points: [
      "View opens the person's saved information.",
      "Delete permanently removes the person from the current Contacted Me list.",
      "Accept moves the person into Clients.",
      "Accept + Contact moves the person into Clients and also adds the available contact information to your device contacts when supported.",
      "New leads are added at the bottom so an older waiting person is not buried by newer calls.",
      "The number shown for Contacted Me is the current number of records in that list. It is different from the permanent Contacted You statistic.",
    ],
    links: ["Clients"],
  },
  {
    id: "clients",
    title: "Clients",
    summary: "Clients shows the people you have accepted and currently keep in your client list, with the newest accepted client shown first.",
    points: [
      "View opens the client's saved information.",
      "Edit lets you update the client's saved details.",
      "Contact opens the available device contact workflow when supported.",
      "Confirm Date creates a calendar item from the available appointment or job information when supported.",
      "Delete removes the client from the current list. It does not erase the historical Clients statistic.",
      "The number shown on the Clients list is the current number of saved clients, not the lifetime total.",
    ],
    links: ["Clients"],
  },
  {
    id: "business-settings",
    title: "Business Details",
    summary: "Open Settings from the gear button in the upper-right corner. Business Details contains the information entered when the account was created.",
    points: [
      "You can update the business name, owner name, notification email, and notification phone while the account has full access.",
      "Press Save Settings after making changes.",
      "Authorized ARK administrators can see the business and account details needed to operate and support the service.",
    ],
    links: ["Settings"],
  },
  {
    id: "billing",
    title: "Billing, missed payments, and access",
    summary: "The Payment Method section is inside Settings and opens Stripe's secure billing portal. Payment notices also provide a direct Update Payment button.",
    points: [
      "Use the billing portal to add, replace, remove, or update payment methods when Stripe allows the action.",
      "Full card details are handled by Stripe. ARK does not receive or store your full card number.",
      "After Stripe reports an unpaid scheduled payment, the system normally waits 24 hours before showing the incident or starting enforcement.",
      "Payment incidents are counted in a rolling six-month period.",
      "A first incident normally receives seven days of full-access grace after the initial 24 hours. A second incident within six months can enter restricted mode after the initial 24 hours. A third or later incident can enter manual deletion review after the initial 24 hours.",
      "Payment-restricted mode allows new leads to arrive and allows those leads to be reviewed and accepted into Clients. Settings, help requests, change requests, data exports, and other account features are unavailable.",
      "When Stripe confirms payment, full access is designed to restore automatically.",
      "Permanent deletion is not automatic. An authorized ARK administrator must review and separately confirm it.",
    ],
    links: ["Settings", "Payment Terms"],
  },
  {
    id: "request-change",
    title: "Request a Change",
    summary: "Use Request a Change on the Requests page for routine updates, improvements, questions, and data-export requests that are not urgent business outages.",
    points: [
      "Examples include changing wording, voice, speed, business information, hours, appearance, or another normal service setting.",
      "You can also request an export or downloadable copy of account or client data while the account is in good standing.",
      "Enter a subject, explain the requested change in Details, and press Send Change Request.",
      "A new request begins as Submitted. ARK may mark it In Progress, Completed, or Denied and may include a message explaining the decision or result.",
      "Closed requests remain in your account history but leave the administrator's active work queue.",
      "Requests are unavailable while the account is payment-restricted.",
    ],
    links: ["Requests"],
  },
  {
    id: "priority-help",
    title: "Priority Help",
    summary: "Priority Help is available on the Requests page for serious problems that are currently affecting the business.",
    points: [
      "Examples include the business number not answering, the receptionist not working, missing lead data, or another major service failure.",
      "Enter what is broken as the subject, explain what is happening, and press Send Priority Help.",
      "ARK treats genuine priority problems as urgent.",
      "Routine changes sent as Priority Help may be denied, handled as a normal request, or returned with instructions to resubmit through Request a Change.",
      "Priority Help is unavailable while the account is payment-restricted; use the payment controls to restore access.",
    ],
    links: ["Requests"],
  },
  {
    id: "terms-privacy",
    title: "Terms of Use and Privacy Policy",
    summary: "Settings provides links to the current Terms of Use and Privacy Policy while the account has full access. Payment notices include a Learn More link to the payment-enforcement terms.",
    points: [
      "The Terms explain recurring billing, included services, usage charges, payment enforcement, cancellation, account restrictions, exports, manual deletion review, and permanent deletion.",
      "The Privacy Policy explains what information is saved, why it is used, which authorized people and providers can access it, and how restriction, retention, export, and deletion work.",
      "The version and effective date are shown on each policy page.",
      "ARK may require renewed acceptance after a material policy update. When renewed acceptance is required, access may be limited until the current policies are accepted.",
    ],
    links: ["Terms of Use", "Privacy Policy"],
  },
  {
    id: "data-account",
    title: "Data exports, cancellation, and account deletion",
    summary: "You can ask ARK for a data export, cancellation, or account deletion through the Requests page while the account has full access.",
    points: [
      "Use Request a Change for a normal data-export or cancellation request.",
      "Use Priority Help when you need immediate account deletion or there is a serious account-access or security problem.",
      "Request an export before deletion and while required service charges are paid. ARK may postpone or decline export preparation while the account is unpaid or payment-restricted.",
      "A normal cancellation generally keeps service available through the current paid billing period and stops it before the next renewal, unless a different written agreement applies.",
      "Permanent deletion requires administrator confirmation. After active account data is deleted, it may not be recoverable or available for export, although limited billing, security, backup, agreement, or legal records may be retained where required or permitted.",
    ],
    links: ["Requests", "Payment Terms", "Terms of Use", "Privacy Policy"],
  },
  {
    id: "where-things-are",
    title: "Where to find everything",
    summary: "Use this quick map when you know what you need but not where it is.",
    points: [
      "Stats: top of the Clients page while the account has full access.",
      "Contacted Me and Clients: main Clients page below Your Stats.",
      "Business details and Save Settings: Settings.",
      "Payment methods: Settings, then Payment Method, or Update Payment in an account notice.",
      "Routine changes and data exports: Requests, then Request a Change.",
      "Serious service problems: Requests, then Priority Help.",
      "Terms, Privacy, and Docs: Settings, or use the global Help button.",
      "AI assistance: press Help on any full-access signed-in page, then Ask AI for Help.",
    ],
    links: ["Clients", "Settings", "Requests", "Payment Terms", "Terms of Use", "Privacy Policy"],
  },
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
