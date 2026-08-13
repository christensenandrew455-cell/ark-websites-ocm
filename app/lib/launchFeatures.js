// Launch switches: change an "off" value to "on" when that feature is ready.
export const RELEASE_SWITCHES = Object.freeze({
  messages: "off",
  employees: "off",
  phoneVerification: "off",
});

export const MESSAGES_AVAILABLE = RELEASE_SWITCHES.messages === "on";
export const EMPLOYEES_AVAILABLE = RELEASE_SWITCHES.employees === "on";
export const PHONE_VERIFICATION_REQUIRED = RELEASE_SWITCHES.phoneVerification === "on";

export const UPCOMING_FEATURE_LABEL = "Available next month";
const upcomingFeatureNames = [
  ...(!MESSAGES_AVAILABLE ? ["Messages"] : []),
  ...(!EMPLOYEES_AVAILABLE ? ["Employees"] : []),
];
const upcomingFeatureList = upcomingFeatureNames.length === 2
  ? `${upcomingFeatureNames[0]} and ${upcomingFeatureNames[1]}`
  : upcomingFeatureNames[0] || "Upcoming features";
export const UPCOMING_FEATURE_MESSAGE = `${upcomingFeatureList} ${upcomingFeatureNames.length === 1 ? "is" : "are"} ${UPCOMING_FEATURE_LABEL.toLowerCase()}.`;

export function availableAccountFeatures(source = {}) {
  const messagesEnabled = MESSAGES_AVAILABLE && source.messagesEnabled === true;
  const employeesEnabled = EMPLOYEES_AVAILABLE && source.employeesEnabled === true;
  return {
    messagesEnabled,
    employeesEnabled,
    employeeMessagingEnabled: messagesEnabled && employeesEnabled && source.employeeMessagingEnabled === true,
  };
}
