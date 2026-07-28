function text(value) {
  return String(value || "").trim();
}

export const ARK_SUPPORT_URL = text(process.env.ARK_CLIENT_CENTER_SUPPORT_URL) || "https://arkwebsites.com/support";

const STOP_KEYWORDS = new Set(["STOP"]);
const START_KEYWORDS = new Set(["START", "UNSTOP", "SUBSCRIBE"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO", "REPORT", "ABUSE"]);
const CONFIRM_KEYWORDS = new Set(["YES", "CONFIRM"]);
const CANCEL_KEYWORDS = new Set(["CANCEL", "NO"]);

export function messagingKeyword(value) {
  const normalized = text(value).toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) return "";
  if (STOP_KEYWORDS.has(normalized)) return "stop";
  if (START_KEYWORDS.has(normalized)) return "start";
  if (HELP_KEYWORDS.has(normalized)) return "help";
  if (CONFIRM_KEYWORDS.has(normalized)) return "confirm";
  if (CANCEL_KEYWORDS.has(normalized)) return "cancel";
  return "";
}

export function optInConfirmationMessage(businessName) {
  const brand = text(businessName) || "this business";
  return `${brand}: Thanks for contacting us. Message frequency varies. Message and data rates may apply. Reply HELP for help. Reply STOP to opt out.`;
}

export function helpConfirmationMessage() {
  return `ARK Client Center: For messaging support or to report a concern, visit ${ARK_SUPPORT_URL}. Reply STOP to opt out.`;
}

export function optOutConfirmationMessage(businessName) {
  const brand = text(businessName) || "this business";
  return `${brand}: You are unsubscribed and will receive no further messages.`;
}

export function optOutRequestMessage(businessName) {
  const brand = text(businessName) || "this business";
  return `${brand}: You replied STOP. Reply YES to confirm or CANCEL to keep receiving messages.`;
}

export function optOutCanceledMessage(businessName) {
  const brand = text(businessName) || "this business";
  return `${brand}: Opt-out canceled. You can continue receiving messages.`;
}

export function optInKeywordConfirmationMessage(businessName) {
  const brand = text(businessName) || "this business";
  return `${brand}: You are subscribed to customer-care messages. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to opt out.`;
}
