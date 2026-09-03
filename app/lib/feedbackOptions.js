export const FEEDBACK_SENTIMENTS = Object.freeze([
  Object.freeze({ key: "negative", label: "Needs work", shortLabel: "Bad" }),
  Object.freeze({ key: "neutral", label: "An idea or mixed", shortLabel: "Okay" }),
  Object.freeze({ key: "positive", label: "Going well", shortLabel: "Good" }),
]);

export const FEEDBACK_TOPICS = Object.freeze([
  Object.freeze({ key: "overall", label: "Overall experience" }),
  Object.freeze({ key: "receptionist", label: "AI receptionist" }),
  Object.freeze({ key: "leads", label: "Leads and clients" }),
  Object.freeze({ key: "billing", label: "Plans and billing" }),
  Object.freeze({ key: "app", label: "Client Center app" }),
  Object.freeze({ key: "other", label: "Something else" }),
]);

export function feedbackSentiment(value) {
  const key = String(value || "").trim().toLowerCase();
  return FEEDBACK_SENTIMENTS.find((option) => option.key === key) || null;
}

export function feedbackTopic(value) {
  const key = String(value || "").trim().toLowerCase();
  return FEEDBACK_TOPICS.find((option) => option.key === key) || null;
}
