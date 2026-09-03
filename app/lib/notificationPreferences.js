export const NOTIFICATION_CHANNELS = Object.freeze(["email", "sms"]);
export const NOTIFICATION_SMS_FROM_E164 = "+17742316164";
export const NOTIFICATION_SMS_FROM_DISPLAY = "(774) 231-6164";

function text(value) {
  return String(value || "").trim();
}

function validEmail(value) {
  const email = text(value).toLowerCase().slice(0, 254);
  return /^\S+@\S+\.\S+$/.test(email) ? email : "";
}

function validUsPhone(value) {
  const digits = text(value).replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{10}$/.test(local) ? `+1${local}` : "";
}

export function normalizeNotificationChannels(value) {
  const requested = Array.isArray(value) ? value : [];
  const selected = new Set(requested.map((channel) => text(channel).toLowerCase()));
  return NOTIFICATION_CHANNELS.filter((channel) => selected.has(channel));
}

export function normalizeNotificationPreferences(value = {}, contacts = {}) {
  const channels = normalizeNotificationChannels(value.notificationChannels || value.channels);
  const notificationEmail = validEmail(value.notificationEmail || contacts.accountEmail);
  const notificationPhone = validUsPhone(value.notificationPhone || contacts.accountPhone);
  return {
    notificationChannels: channels,
    notificationEmail,
    notificationPhone,
    notificationPreferencesCompleted: value.notificationPreferencesCompleted === true,
  };
}

export function notificationPreferenceError(value = {}, contacts = {}) {
  const preferences = normalizeNotificationPreferences(value, contacts);
  if (!preferences.notificationChannels.length) return "Choose email, text message, or both.";
  if (preferences.notificationChannels.includes("email") && !preferences.notificationEmail) {
    return "A valid account email is required for email notifications.";
  }
  if (preferences.notificationChannels.includes("sms") && !preferences.notificationPhone) {
    return "A valid U.S. account phone number is required for text notifications.";
  }
  return "";
}

export function formatNotificationPhone(value) {
  const phone = validUsPhone(value);
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : text(value);
}
