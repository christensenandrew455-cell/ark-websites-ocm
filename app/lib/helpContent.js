export const HELP_LINKS = [
  { label: "Clients", href: "/" },
  { label: "Settings", href: "/settings" },
  { label: "Requests", href: "/messages" },
  { label: "Docs", href: "/docs" },
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
      "The Help button is available throughout the signed-in app. It can open these docs or start a quick AI help chat.",
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
      "Usage shows recorded usage above the amount included with your plan. Applicable overage charges can be added to your next payment. For example, a $50 overage added to a $500 payment would make the next payment $550.",
      "Clients is a permanent total of people accepted as clients. Deleting a client later does not reduce the historical total.",
      "The numbers in Your Stats are historical records. The live Contacted Me and Clients lists below them show only the records currently in those lists.",
    ],
    links: ["Clients"],
  },
  {
    id: "contacted-me",
    title: "Contacted Me",
    summary: "Contacted Me shows the people who are currently waiting for your review.",
    points: [
      "View opens the person's saved information.",
      "Decline removes the person from the current Contacted Me list.",
      "Accept moves the person into Clients.",
      "Accept + Contact moves the person into Clients and also adds the available contact information to your device contacts when supported.",
      "The number shown for Contacted Me is the current number of records in that list. It is different from the permanent Contacted You statistic.",
    ],
    links: ["Clients"],
  },
  {
    id: "clients",
    title: "Clients",
    summary: "Clients shows the people you have accepted and currently keep in your client list.",
    points: [
      "View opens the client's saved information.",
      "Edit lets you update the client's saved details.",
      "Add to Calendar creates a calendar item from the available appointment or job information when supported.",
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
      "You can update the business name, owner name, notification email, and notification phone.",
      "Press Save Settings after making changes.",
      "Authorized ARK administrators can see the business and account details needed to operate and support the service.",
    ],
    links: ["Settings"],
  },
  {
    id: "billing",
    title: "Billing and payment methods",
    summary: "The Payment Method section is inside Settings and opens Stripe's secure billing portal.",
    points: [
      "Use the billing portal to add, replace, remove, or update payment methods when Stripe allows the action.",
      "Full card details are handled by Stripe. ARK does not receive or store your full card number.",
      "You are trusting Stripe to process and secure card information. Card identity, card-security, or Stripe processing disputes may need to be handled directly with Stripe or the card provider.",
      "ARK can help you find the billing controls, but ARK cannot view or edit the full card information stored by Stripe.",
    ],
    links: ["Settings"],
  },
  {
    id: "request-change",
    title: "Request a Change",
    summary: "Use Request a Change on the Requests page for routine updates, improvements, questions, and data-export requests that are not urgent business outages.",
    points: [
      "Examples include changing wording, voice, speed, business information, hours, appearance, or another normal service setting.",
      "You can also request an export or downloadable copy of account or client data.",
      "Enter a subject, explain the requested change in Details, and press Send Change Request.",
      "A new request begins as Submitted. ARK may mark it In Progress, Completed, or Denied and may include a message explaining the decision or result.",
      "You will be able to review the request and any ARK message in Your Requests.",
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
    ],
    links: ["Requests"],
  },
  {
    id: "terms-privacy",
    title: "Terms of Use and Privacy Policy",
    summary: "Settings always provides links to the current Terms of Use and Privacy Policy.",
    points: [
      "The Terms explain recurring billing, included services, usage charges, cancellation, account enforcement, exports, and deletion.",
      "The Privacy Policy explains what information is saved, why it is used, which authorized people and providers can access it, and how to request access, export, correction, or deletion.",
      "The version and effective date are shown on each policy page.",
      "ARK may require renewed acceptance after a material policy update. When renewed acceptance is required, access may be limited until the current policies are accepted.",
    ],
    links: ["Terms of Use", "Privacy Policy"],
  },
  {
    id: "data-account",
    title: "Data exports, cancellation, and account deletion",
    summary: "You can ask ARK for a data export, cancellation, or account deletion through the Requests page.",
    points: [
      "Use Request a Change for a normal data-export or cancellation request.",
      "Use Priority Help when you need immediate account deletion or there is a serious account-access or security problem.",
      "Request an export before deletion whenever possible. ARK will prepare the available account or client data in a transferable file when reasonably possible.",
      "A normal cancellation generally keeps service available through the current paid billing period and stops it before the next renewal, unless a different written agreement applies.",
      "Immediate deletion can remove access sooner. Deleted active account data may not be recoverable, although limited billing, security, backup, agreement, or legal records may be retained where required or permitted.",
    ],
    links: ["Requests", "Terms of Use", "Privacy Policy"],
  },
  {
    id: "where-things-are",
    title: "Where to find everything",
    summary: "Use this quick map when you know what you need but not where it is.",
    points: [
      "Stats: top of the Clients page.",
      "Contacted Me and Clients: main Clients page below Your Stats.",
      "Business details and Save Settings: Settings.",
      "Payment methods: Settings, then Payment Method.",
      "Routine changes and data exports: Requests, then Request a Change.",
      "Serious service problems: Requests, then Priority Help.",
      "Terms, Privacy, and Docs: Settings, or use the global Help button.",
      "AI assistance: press Help on any signed-in page, then Ask AI for Help.",
    ],
    links: ["Clients", "Settings", "Requests", "Terms of Use", "Privacy Policy"],
  },
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
