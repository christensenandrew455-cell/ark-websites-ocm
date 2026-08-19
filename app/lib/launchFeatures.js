// Launch switches: change an "off" value to "on" when that feature is ready.
export const RELEASE_SWITCHES = Object.freeze({
  messages: "off",
  phoneVerification: "on",
});

export const MESSAGES_AVAILABLE = RELEASE_SWITCHES.messages === "on";
export const PHONE_VERIFICATION_REQUIRED = RELEASE_SWITCHES.phoneVerification === "on";

export const UPCOMING_FEATURE_LABEL = "Not available until next month";
export const UPCOMING_FEATURE_MESSAGE = "This feature is not available.";

export function availableAccountFeatures(source = {}) {
  return {
    messagesEnabled: MESSAGES_AVAILABLE && source.messagesEnabled === true,
  };
}
