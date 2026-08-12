const NETWORK_ERROR_PATTERN = /auth\/network-request-failed|network-request-failed|failed to fetch|networkerror|network error|load failed|internet connection|offline/i;
const INTERNAL_ERROR_PATTERN = /firebase|firestore|auth\/|functions\/|storage\/|stripe|api key|private key|credential|permission-denied|service account|requires an index|deadline exceeded|quota|internal|unexpected token|html error page|server configuration|not configured/i;

function text(error) {
  if (typeof error === "string") return error.trim();
  return String(error?.message || error?.code || "").trim();
}

export function isNetworkError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return NETWORK_ERROR_PATTERN.test(text(error));
}

export function ownerFacingError(error) {
  return isNetworkError(error)
    ? "No internet connection. Reload and try again."
    : "Something went wrong. Reload and try again.";
}

export function publicFormError(error, fallback = "Something went wrong. Reload and try again.") {
  const message = text(error);
  if (isNetworkError(error)) return "No internet connection. Reload and try again.";
  if (!message || INTERNAL_ERROR_PATTERN.test(message)) return fallback;
  return message;
}
