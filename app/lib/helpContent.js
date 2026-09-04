import { MESSAGES_AVAILABLE } from "./launchFeatures.js";
import { TEMPORARY_FEATURES } from "./temporaryFeatures.js";

const ALL_HELP_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Messages", href: "/lead-messages" },
  { label: "Settings", href: "/settings" },
  { label: "Refer & Save", href: "/rewards" },
  { label: "Help & Account", href: "/settings?section=account" },
  { label: "AI Chat", href: "/settings?section=account&chat=open" },
  { label: "Support", href: "/messages" },
  ...(TEMPORARY_FEATURES.feedback.enabled ? [{ label: "Give Feedback", href: "/feedback" }] : []),
  { label: "Your Data", href: "/settings?section=customization#account-data" },
  { label: "Docs", href: "/docs" },
  { label: "Public Support", href: "https://arkwebsites.com/support" },
  { label: "Payment Terms", href: "/terms#paid-service" },
  { label: "Payment Enforcement", href: "/terms#payment-enforcement" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_LINKS = ALL_HELP_LINKS.filter((link) => MESSAGES_AVAILABLE || link.label !== "Messages");

export const HELP_SECTIONS = [
  {
    id: "start-here",
    title: "Start here",
    summary: "ARK answers calls, creates service requests, and puts them in Client Center for the business owner to review.",
    points: [
      `Dashboard shows the ARK receptionist number and shortcuts to New Leads${MESSAGES_AVAILABLE ? ", Messages" : ""}, Settings, and the temporary Refer & Save offer when eligible.`,
      "A new account usually receives its ARK phone number within 24–48 hours. Calls to that number go to the AI receptionist.",
      "Leads contains Contacted You for new requests and Clients for accepted requests.",
      "Settings contains Business information, Customization, Plan and payment, and Help & Account.",
      "The owner decides whether to accept or decline every request. ARK does not make that business decision.",
    ],
    links: ["Dashboard", "Leads", "Settings"],
  },
  {
    id: "signup",
    title: "Account setup",
    summary: "Signup has five steps: account information, verification, business information, alert choices, and payment.",
    points: [
      "Step 1 creates the owner account with the business name, owner name, email, phone, and password.",
      "Step 2 sends separate four-digit codes to the email and phone. Both must be verified within the time shown on screen.",
      "Step 3 collects the facts the receptionist needs for calls.",
      "Step 4 chooses email alerts, text alerts, or both. At least one alert method is required.",
      "Step 5 chooses a monthly accepted-lead plan and completes payment with Apple on iPhone or Stripe on supported web and Android flows.",
      "If a verification contact has a typo, use Edit email or phone. New codes replace the old codes.",
    ],
    links: ["Terms of Use", "Privacy Policy"],
  },
  {
    id: "business-information",
    title: "Business Information",
    summary: "These settings control what the receptionist knows and which requests it can collect.",
    points: [
      "Business details are the business name, owner name, account phone, and account email.",
      "Business type and Services tell ARK what work callers can request.",
      "Service area can contain multiple states, or one state with counties. Counties cannot be combined with multiple states.",
      "Additional business information is for titled facts such as warranties, estimates, materials, parking, or policies. The receptionist can use those facts when answering callers.",
      "Changes save automatically. Return to Settings after the latest change finishes saving.",
    ],
    links: ["Settings"],
  },
  {
    id: "scheduling-emergencies",
    title: "Scheduling and emergencies",
    summary: "ARK collects a requested time. It does not book or promise an appointment.",
    points: [
      "Regular scheduling uses the business time zone, open days, opening time, and closing time.",
      "Open every day hides the individual day choices. Turn it off to show them again.",
      "Open 24 hours hides opening and closing times. Turn it off to show the saved times again.",
      "A latest time earlier than the earliest time means the service window continues overnight.",
      "A caller chooses a preferred day and a broad morning or afternoon window. The owner confirms the exact date and time after accepting the lead.",
      "Turn on Take emergency calls only when the business accepts urgent or ASAP work. Regular requests remain available.",
      "Emergency availability has two choices: Any time, or During regular hours. ARK uses the regular schedule instead of making the business maintain a second schedule.",
      "Emergency requests are marked urgent, but ARK does not promise dispatch or an arrival time.",
    ],
    links: ["Settings", "Leads"],
  },
  {
    id: "new-leads",
    title: "Contacted You",
    summary: "Contacted You holds new service requests until the owner accepts or declines them.",
    points: [
      "Before acceptance, a card shows the job, requested time, notes, received time, urgency, and risk level while customer identity stays hidden.",
      "Emergency requests appear separately with a red Emergency badge.",
      "Regular lead card colors show age: blue is new, amber has waited longer, and red is overdue.",
      "Accept reveals the customer information, moves the request to Clients, and uses one accepted lead from the plan.",
      "Decline permanently removes the request. If customer decision texts are on, ARK attempts to send the customer a decline notice.",
    ],
    links: ["Leads", "Settings"],
  },
  {
    id: "risk-levels",
    title: "Lead risk levels",
    summary: "Risk is a warning signal based on the request, not a final decision about a person.",
    points: [
      "Low is 0–2 points, Moderate is 3–5, High is 6–8, and Very high is 9 or more.",
      "Risk check unavailable means ARK did not produce a score for that request.",
      "The owner should review the whole request and use independent judgment before accepting, declining, visiting, or contacting anyone.",
    ],
    links: ["Leads"],
  },
  {
    id: "clients",
    title: "Clients",
    summary: "Clients contains accepted requests and their full customer details.",
    points: [
      "Open a client to review or edit the name, phone, address, job, requested window, confirmed estimate date and time, and notes.",
      "Client notes describe the request. Business notes are private to the business.",
      "Add Contact saves the client to the phone when contact access is allowed.",
      "Add to Calendar uses the confirmed estimate date and time, not the caller’s requested window.",
      "Deleting or editing a client does not restore the accepted lead used when the request was accepted.",
    ],
    links: ["Leads"],
  },
  {
    id: "plans-and-leads",
    title: "Plans and accepted leads",
    summary: "Plans limit accepted leads, not calls or new requests.",
    points: [
      "An accepted lead is one unique service request that the owner accepts. It counts once when Accept is tapped.",
      "Calls, declines, repeated acceptance attempts, edits, and deletions do not use the accepted-lead limit.",
      "Starter is $24.99 per month for 25 accepted leads. Standard is $47.49 for 50. Growth is $89.99 for 100. Scale is $169.99 for 200.",
      "The included limit resets to the selected plan amount each billing month. Unused included leads do not roll over.",
      "Extra accepted leads cost $1 each for the current billing month and expire at the next reset.",
      "When no accepted leads remain, change the plan, buy extra leads, or wait for the reset.",
    ],
    links: ["Settings", "Payment Terms"],
  },
  {
    id: "payment",
    title: "Payment and plan changes",
    summary: "Settings → Plan and payment shows leads left, the current plan, payment method, and billing status.",
    points: [
      "Manage opens three controls: Change plan, Add leads, and Payment card.",
      "A Stripe plan change can start at renewal with no charge today, or start now after payment. Starting now begins a new billing month. Unused leads expire. No refunds.",
      "Apple shows and controls the price, timing, renewal, and cancellation for App Store subscriptions.",
      "No refunds.",
      "A failed recurring payment pauses the receptionist and new lead intake. Billing access remains available so the owner can restore payment.",
      "Stripe-billed accounts have the displayed seven-day recovery window before eligible account deletion. Apple-billed accounts follow Apple’s billing-retry schedule.",
    ],
    links: ["Settings", "Payment Terms", "Payment Enforcement"],
  },
  {
    id: "alerts-and-retention",
    title: "Notifications and auto-delete",
    summary: "Customization controls appearance, notifications, customer updates, automatic record deletion, and data download.",
    points: [
      "On the website, Customization shows email and text alert choices. At least one delivery method must stay selected.",
      "The iOS and Android apps hide the website alert controls. App notifications are managed through the phone’s notification settings.",
      "Text alerts are automated transactional messages. Frequency varies, carrier rates may apply, STOP opts out, and HELP gives the support path.",
      "Customer decision texts tell a customer when the owner accepts or declines the request.",
      "Auto-delete options are Never delete, after 1 day, after 1 week, or after 1 month. An auto-deleted record is permanently removed.",
      "On Android, Notifications enables app alerts, Contacts enables Add Contact, and Calendar enables Add to Calendar. These permissions can also be changed in phone settings.",
    ],
    links: ["Settings", "Privacy Policy"],
  },
  ...(MESSAGES_AVAILABLE ? [{
    id: "customer-messages",
    title: "Customer Messages",
    summary: "Messages is a phone-style inbox for conversations with leads and clients.",
    points: [
      "Turn Messages on or off in Customization. All conversations must be deleted before the feature can be turned off.",
      "The Messages page shows conversations and unread replies. Open a lead or client and choose Message to start or continue a chat.",
      "Deleting a chat blocks ARK from reopening or notifying for later messages from that phone number, but it is not a carrier-level opt-out on the other person’s device.",
    ],
    links: ["Messages", "Leads", "Settings", "Privacy Policy"],
  }] : []),
  {
    id: "rewards",
    title: "Refer & Save",
    summary: "A new eligible Stripe-billed account gets one 24-hour chance to earn one free month.",
    points: [
      "The business username is its referral code. A different business must finish paid signup with that code within 24 hours after the referrer’s account is activated.",
      "The offer disappears permanently after one qualifying referral or when the 24-hour window ends.",
      "ARK creates a Stripe credit equal to the referrer’s recurring plan price when the referral qualifies. It starts with the next eligible Stripe bill.",
      "Self-referrals, duplicate accounts, late signups, invalid accounts, and signups that do not use the code do not qualify. Referral rewards have no cash value and cannot be transferred.",
      "Apple-billed accounts are not eligible because Apple requires a separate in-app promotional offer.",
      "Feedback is still welcome, but feedback does not earn a billing reward.",
    ],
    links: ["Refer & Save", ...(TEMPORARY_FEATURES.feedback.enabled ? ["Give Feedback"] : []), "Settings"],
  },
  {
    id: "data-account-help",
    title: "Data, account, and help",
    summary: "Customization contains data download. Help & Account contains Docs, AI Chat, Support, legal policies, and account deletion.",
    points: [
      "Docs explains the app. AI Chat answers from Docs, the Terms of Use, and the Privacy Policy, and links to the relevant page.",
      "AI Chat cannot view private customer details or change the account, billing, leads, or settings. Its chat history clears 24 hours after the last message.",
      "Support is for account, billing, or technical help. The public Support page also accepts privacy and texting concerns.",
      "In Settings → Customization → Your data, Download data saves the supported current account, lead, client, and Help data in a JSON file while the account has access.",
      "Delete account permanently removes the active owner account and supported lead and client data. Download needed data first.",
      "Deleting an ARK account does not cancel an Apple subscription. Cancel with Apple first. Stripe cancellation is handled with ARK account deletion.",
    ],
    links: ["Help & Account", "AI Chat", "Support", "Your Data", "Terms of Use", "Privacy Policy"],
  },
];

export const HELP_KNOWLEDGE = HELP_SECTIONS.map((section) => {
  const points = section.points.map((point) => `- ${point}`).join("\n");
  const links = section.links.join(", ");
  return `## ${section.title}\n${section.summary}\n${points}\nRelevant page links: ${links}`;
}).join("\n\n");
