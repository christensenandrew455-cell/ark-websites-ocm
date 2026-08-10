const CONFIRMATION_EVENT = "ark:request-confirmation";

export function requestAppConfirmation(options = {}) {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(CONFIRMATION_EVENT, {
      detail: { ...options, resolve },
    }));
  });
}

export function confirmationEventName() {
  return CONFIRMATION_EVENT;
}
