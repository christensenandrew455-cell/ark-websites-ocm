export async function readApiJson(response, fallbackMessage = "The server could not complete this request.") {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const rawBody = await response.text();
  let data = {};

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      const isHtml = contentType.includes("text/html") || /^\s*</.test(rawBody);
      const statusLabel = response.status ? ` (${response.status})` : "";
      throw new Error(
        isHtml
          ? `The signup server returned an HTML error page${statusLabel}. The deployment or server configuration failed before the API could respond.`
          : `${fallbackMessage}${statusLabel}`
      );
    }
  }

  if (!response.ok) {
    throw new Error(data.error || `${fallbackMessage} (${response.status})`);
  }

  return data;
}
