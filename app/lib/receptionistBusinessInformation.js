import { trimmedText } from "./valueUtils.js";

function cleanText(value, maximum) {
  return trimmedText(value).slice(0, maximum);
}

export function normalizeBusinessInformation(value, maximumItems = 50) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([title, info]) => ({ title, info }))
      : [];
  const result = [];
  const seen = new Set();
  for (const item of source) {
    const title = cleanText(Array.isArray(item) ? item[0] : item?.title, 120);
    const info = cleanText(Array.isArray(item) ? item[1] : item?.info, 1_000);
    const key = `${title.toLowerCase()}\u0000${info.toLowerCase()}`;
    if (!title || !info || seen.has(key)) continue;
    seen.add(key);
    result.push({ title, info });
    if (result.length >= maximumItems) break;
  }
  return result;
}

export function businessInformationText(value) {
  return normalizeBusinessInformation(value).map(({ title, info }) => `${title}: ${info}`).join("\n");
}
