export async function readApiJson(response, fallbackMessage = "The server could not complete this request.") {
  const rawBody = await response.text();
  let data = {};

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(fallbackMessage);
    }
  }

  if (!response.ok) {
    const error = new Error(data.error || fallbackMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}
