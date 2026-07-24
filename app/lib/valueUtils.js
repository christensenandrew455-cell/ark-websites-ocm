export function trimmedText(value) {
  return String(value ?? "").trim();
}

export function normalizeClientId(value) {
  return trimmedText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function dashBusinessName(value) {
  return String(value ?? "").replace(/\s+/g, " ");
}

export function normalizeBusinessIdentifier(value) {
  const identifier = String(value ?? "");
  return identifier.includes("@") ? identifier : dashBusinessName(identifier);
}

export function toIsoString(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function serializeFirestoreValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value?.seconds === "number" && Object.keys(value).length <= 2) {
    return new Date(value.seconds * 1000).toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeFirestoreValue(item)])
    );
  }
  return value;
}

export function safeFileName(value, fallback = "file") {
  return String(value || fallback)
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || fallback;
}
