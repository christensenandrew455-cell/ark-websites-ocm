function text(value) {
  return String(value || "").trim();
}

export function normalizeTelnyxPhone(value) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function validE164(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function telnyxSystemFromNumber() {
  const from = normalizeTelnyxPhone(process.env.TELNYX_SIGNUP_FROM_NUMBER);
  return /^\+1\d{10}$/.test(from) ? from : "";
}

function providerError(result = {}) {
  const firstError = Array.isArray(result.errors)
    ? result.errors[0]
    : (Array.isArray(result?.data?.errors) ? result.data.errors[0] : null);
  return {
    code: text(firstError?.code || result?.code),
    detail: text(firstError?.detail || firstError?.title || result?.error),
  };
}

export async function sendTelnyxSystemText({ to, message }) {
  const apiKey = text(process.env.TELNYX_API_KEY);
  const from = telnyxSystemFromNumber();
  const normalizedTo = normalizeTelnyxPhone(to);
  const normalizedMessage = text(message);
  if (!apiKey || !from) {
    return {
      ok: false,
      status: "provider-not-configured",
      fromPhone: from,
      providerMessageId: "",
      providerErrorCode: "",
      error: "The system text sender is not configured.",
    };
  }
  if (!validE164(normalizedTo) || !normalizedMessage) {
    return {
      ok: false,
      status: "invalid-message",
      fromPhone: from,
      providerMessageId: "",
      providerErrorCode: "",
      error: !validE164(normalizedTo) ? "A valid destination phone number is required." : "A text message is required.",
    };
  }

  try {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: normalizedTo, text: normalizedMessage }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    const error = providerError(result);
    const delivery = {
      ok: response.ok,
      status: response.ok ? "sent" : "provider-error",
      fromPhone: from,
      providerMessageId: text(result?.data?.id || result?.id),
      providerErrorCode: error.code,
      error: error.detail,
      httpStatus: response.status,
    };
    if (!delivery.ok) {
      console.error("[Telnyx system text] delivery failed", {
        status: delivery.httpStatus,
        code: delivery.providerErrorCode || null,
        detail: delivery.error || null,
      });
    }
    return delivery;
  } catch (error) {
    console.error("[Telnyx system text] request failed", {
      detail: text(error?.message) || "Unknown Telnyx request error.",
    });
    return {
      ok: false,
      status: "provider-error",
      fromPhone: from,
      providerMessageId: "",
      providerErrorCode: "",
      error: text(error?.message) || "The text provider request failed.",
    };
  }
}
