import { createHash } from "node:crypto";

function text(value) { return String(value || "").trim(); }

export function normalizeMessagePhone(value) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function messageContactBlockId(clientId, phone) {
  const normalized = normalizeMessagePhone(phone);
  if (!text(clientId) || !normalized) return "";
  return createHash("sha256")
    .update(`${text(clientId)}:${normalized}`)
    .digest("hex")
    .slice(0, 48);
}

export function messageContactBlockRef(db, clientId, phone) {
  const id = messageContactBlockId(clientId, phone);
  if (!id) return null;
  return db.collection("ocmClients").doc(clientId).collection("blockedMessageContacts").doc(id);
}

export async function isMessageContactBlocked(db, clientId, phone) {
  const ref = messageContactBlockRef(db, clientId, phone);
  if (!ref) return false;
  return (await ref.get()).exists;
}
